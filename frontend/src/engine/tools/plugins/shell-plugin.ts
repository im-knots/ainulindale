/**
 * Shell Plugin - Local command execution
 *
 * Converts ShellProvider to the plugin interface.
 * Uses Tauri shell commands for native execution.
 */

import { z } from 'zod';
import {
  ToolPlugin,
  PluginCategory,
  ValidationResult,
  ExecutionContext,
  PluginUIConfig,
} from '../plugin';
import { ToolDefinition, ZodToolDefinition, ToolResult, zodToJsonSchema, JSONSchema7 } from '../types';

const SAFE_DEFAULT_WORKING_DIR = '/tmp';

// Shell event types from Tauri streaming
type ShellEvent = { Stdout: string } | { Stderr: string } | { Exit: number };

// Result type from Tauri shell command
interface ShellResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

// Zod schemas for shell tools
const executeSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  cwd: z.string().optional().describe('Working directory for the command'),
});

const executeScriptSchema = z.object({
  script: z.string().describe('Multi-line script content to execute'),
  interpreter: z.string().optional().default('bash').describe('Script interpreter (bash, python, node, etc.)'),
});

// Configuration schema for the shell plugin
const configSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    shell: {
      type: 'string',
      title: 'Shell',
      description: 'Shell to use for command execution',
      default: 'bash',
    },
    workingDirectory: {
      type: 'string',
      title: 'Working Directory',
      description: 'Default working directory for commands',
      default: '/tmp',
    },
    allowedCommands: {
      type: 'array',
      items: { type: 'string' },
      title: 'Allowed Commands',
      description: 'Allowlist of base commands (empty = allow all)',
      default: [],
    },
    timeout: {
      type: 'number',
      title: 'Timeout (ms)',
      description: 'Command timeout in milliseconds',
      default: 30000,
    },
  },
  required: [],
};



interface ShellConfig {
  shell?: string;
  workingDirectory?: string;
  allowedCommands?: string[];
  timeout?: number;
}

export class ShellPlugin implements ToolPlugin {
  // === Identity ===
  id = 'shell';
  name = 'Shell';
  description = 'Execute shell commands locally';
  icon = 'terminal';
  category: PluginCategory = 'local';

  // === Configuration ===
  configSchema = configSchema;
  defaultConfig = { shell: 'bash', workingDirectory: SAFE_DEFAULT_WORKING_DIR, allowedCommands: [], timeout: 30000 };

  // === UI Configuration ===
  ui: PluginUIConfig = {
    detailTabs: [{ id: 'output', label: 'Terminal' }],
    hasConfigPanel: true,
    defaultTab: 'output',
  };

  private config: ShellConfig = {};
  private commandHistory: { command: string; timestamp: Date; result: string }[] = [];

  validateConfig(config: unknown): ValidationResult {
    if (typeof config !== 'object' || config === null) {
      return { valid: false, errors: [{ field: 'config', message: 'Configuration must be an object' }] };
    }
    const cfg = config as Record<string, unknown>;
    if (cfg.shell !== undefined && typeof cfg.shell !== 'string') {
      return { valid: false, errors: [{ field: 'shell', message: 'Shell must be a string' }] };
    }
    if (cfg.workingDirectory !== undefined && typeof cfg.workingDirectory !== 'string') {
      return { valid: false, errors: [{ field: 'workingDirectory', message: 'Working directory must be a string' }] };
    }
    if (cfg.allowedCommands !== undefined && !Array.isArray(cfg.allowedCommands)) {
      return { valid: false, errors: [{ field: 'allowedCommands', message: 'Allowed commands must be an array' }] };
    }
    return { valid: true };
  }

  // === Environment ===
  isAvailable(): boolean {
    // Always available - app runs exclusively in Tauri
    return true;
  }

  // === Lifecycle ===
  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      shell: (config.shell as string) || 'bash',
      workingDirectory: (config.workingDirectory as string) || SAFE_DEFAULT_WORKING_DIR,
      allowedCommands: (config.allowedCommands as string[]) || [],
      timeout: (config.timeout as number) || 30000,
    };
    console.log(`[ShellPlugin] Initialized with workingDirectory: ${this.config.workingDirectory}`);
  }

  // === Capabilities ===
  getTools(): ToolDefinition[] {
    return [
      { name: 'execute', description: 'Execute a shell command', parameters: zodToJsonSchema(executeSchema) },
      { name: 'execute_script', description: 'Execute a multi-line script', parameters: zodToJsonSchema(executeScriptSchema) },
    ];
  }

  getZodTools(): ZodToolDefinition[] {
    return [
      { name: 'execute', description: 'Execute a shell command', schema: executeSchema, execute: async (p) => this.execute('execute', p, {} as ExecutionContext) },
      { name: 'execute_script', description: 'Execute a multi-line script', schema: executeScriptSchema, execute: async (p) => this.execute('execute_script', p, {} as ExecutionContext) },
    ];
  }

  async execute(toolName: string, params: Record<string, unknown>, _context: ExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const workingDir = (params.cwd as string) || (params.workingDirectory as string) || this.config.workingDirectory;

    try {
      let result: unknown;
      switch (toolName) {
        case 'execute': result = await this.executeCommand(params.command as string, workingDir); break;
        case 'execute_script': result = await this.executeScript(params.script as string, (params.interpreter as string) || 'bash', workingDir); break;
        default: return { success: false, error: `Unknown tool: ${toolName}`, duration: Date.now() - start };
      }
      return { success: true, result, duration: Date.now() - start };
    } catch (error) {
      return { success: false, error: String(error), duration: Date.now() - start };
    }
  }

  // === Private helper methods ===
  private async executeCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Validate command against allowlist if configured
    if (this.config.allowedCommands && this.config.allowedCommands.length > 0) {
      const baseCommand = command.split(' ')[0];
      if (!this.config.allowedCommands.includes(baseCommand)) {
        throw new Error(`Command not allowed: ${baseCommand}. Allowed: ${this.config.allowedCommands.join(', ')}`);
      }
    }

    const workingDir = cwd || this.config.workingDirectory || SAFE_DEFAULT_WORKING_DIR;
    console.log(`[ShellPlugin] Executing: ${command} (in ${workingDir})`);

    this.commandHistory.push({ command, timestamp: new Date(), result: 'pending' });

    const { invoke, Channel } = await import('@tauri-apps/api/core');
    const onEvent = new Channel<ShellEvent>();
    const streamedOutput: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };

    onEvent.onmessage = (event) => {
      if ('Stdout' in event) streamedOutput.stdout.push(event.Stdout);
      else if ('Stderr' in event) streamedOutput.stderr.push(event.Stderr);
    };

    const result = await invoke<ShellResult>('execute_shell', { command, cwd: workingDir, onEvent });

    const lastEntry = this.commandHistory[this.commandHistory.length - 1];
    if (lastEntry && lastEntry.command === command) {
      lastEntry.result = result.exit_code === 0 ? 'success' : 'failed';
    }

    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exit_code };
  }

  private async executeScript(script: string, interpreter: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    console.log(`[ShellPlugin] Executing script with ${interpreter} (${script.length} chars) in ${cwd || 'default'}`);

    let command: string;
    switch (interpreter) {
      case 'bash':
      case 'sh':
      case 'zsh':
      case 'python':
      case 'python3':
        command = `${interpreter} -c ${this.escapeShellArg(script)}`;
        break;
      case 'node':
        command = `${interpreter} -e ${this.escapeShellArg(script)}`;
        break;
      default:
        command = `${interpreter} -c ${this.escapeShellArg(script)}`;
    }

    return this.executeCommand(command, cwd);
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  // Utility methods for debugging/audit
  getHistory(): { command: string; timestamp: Date; result: string }[] {
    return [...this.commandHistory];
  }

  clearHistory(): void {
    this.commandHistory = [];
  }
}

