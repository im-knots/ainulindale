/**
 * Tasklist Plugin - Task queue management
 *
 * Converts TasklistToolProvider to the plugin interface.
 * Provides tools for managing tasks in tasklist hex entities.
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

// Module-level reference to get ToolActor - set by BoardRunner
let getToolActorFn: ((hexKey: string) => unknown) | null = null;

/**
 * Set the function to get ToolActor instances.
 * Called by BoardRunner when starting.
 */
export function setToolActorGetter(fn: (hexKey: string) => unknown): void {
  getToolActorFn = fn;
}

/**
 * Clear the ToolActor getter (called when board stops)
 */
export function clearToolActorGetter(): void {
  getToolActorFn = null;
}

// Zod schemas for tasklist tools
const addTaskSchema = z.object({
  title: z.string().describe('Brief actionable summary of the task'),
  description: z.string().optional().describe('Detailed context including file paths, requirements, acceptance criteria'),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional().default('normal').describe('Task priority'),
});

const listTasksSchema = z.object({
  status: z.enum(['all', 'pending', 'processing', 'completed']).optional().default('all').describe('Filter by task status'),
});

const getTaskSchema = z.object({
  taskId: z.string().describe('ID of the task to retrieve'),
});

// Configuration schema for the tasklist plugin
const configSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    maxTasks: {
      type: 'number',
      title: 'Max Tasks',
      description: 'Maximum number of tasks allowed in the queue',
      default: 100,
    },
  },
  required: [],
};

export class TasklistPlugin implements ToolPlugin {
  // === Identity ===
  id = 'tasklist';
  name = 'Task List';
  description = 'Manage tasks in a task queue';
  icon = 'list-checks';
  category: PluginCategory = 'local';

  // === Configuration ===
  configSchema = configSchema;
  defaultConfig = { maxTasks: 100 };

  // === UI Configuration ===
  ui: PluginUIConfig = {
    detailTabs: [
      { id: 'tasks', label: 'Tasks' },
      { id: 'logs', label: 'Logs' },
    ],
    hasConfigPanel: true,
    defaultTab: 'tasks',
  };

  private config: { maxTasks?: number } = {};

  validateConfig(config: unknown): ValidationResult {
    if (typeof config !== 'object' || config === null) {
      return { valid: false, errors: [{ field: 'config', message: 'Configuration must be an object' }] };
    }
    const cfg = config as Record<string, unknown>;
    if (cfg.maxTasks !== undefined && typeof cfg.maxTasks !== 'number') {
      return { valid: false, errors: [{ field: 'maxTasks', message: 'Max tasks must be a number' }] };
    }
    return { valid: true };
  }

  // === Environment ===
  isAvailable(): boolean {
    // Tasklist is always available - it's pure in-memory
    return true;
  }

  // === Lifecycle ===
  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = { maxTasks: (config.maxTasks as number) || 100 };
    console.log(`[TasklistPlugin] Initialized with maxTasks: ${this.config.maxTasks}`);
  }

  // === Capabilities ===
  getTools(): ToolDefinition[] {
    return [
      { name: 'add_task', description: 'Add a new task to the queue', parameters: zodToJsonSchema(addTaskSchema) },
      { name: 'list_tasks', description: 'List tasks in the queue', parameters: zodToJsonSchema(listTasksSchema) },
      { name: 'get_task', description: 'Get details of a specific task', parameters: zodToJsonSchema(getTaskSchema) },
    ];
  }

  getZodTools(): ZodToolDefinition[] {
    return [
      { name: 'add_task', description: 'Add a new task to the queue', schema: addTaskSchema, execute: async (p) => this.execute('add_task', p, {} as ExecutionContext) },
      { name: 'list_tasks', description: 'List tasks in the queue', schema: listTasksSchema, execute: async (p) => this.execute('list_tasks', p, {} as ExecutionContext) },
      { name: 'get_task', description: 'Get details of a specific task', schema: getTaskSchema, execute: async (p) => this.execute('get_task', p, {} as ExecutionContext) },
    ];
  }

  async execute(toolName: string, params: Record<string, unknown>, _context: ExecutionContext): Promise<ToolResult> {
    const start = Date.now();

    // Get the hex key from the merged params (injected by agent-tools)
    const hexKey = params._sourceHexKey as string | undefined;
    if (!hexKey) {
      return { success: false, error: 'No source hex key provided - cannot find tasklist actor', duration: Date.now() - start };
    }

    if (!getToolActorFn) {
      return { success: false, error: 'Board is not running - cannot execute tasklist operations', duration: Date.now() - start };
    }

    const toolActor = getToolActorFn(hexKey) as {
      addTask: (title: string, description?: string, priority?: string) => unknown;
      getTasks: () => unknown[];
      getTask: (taskId: string) => unknown;
    } | undefined;

    if (!toolActor) {
      return { success: false, error: `No tool actor found for hex ${hexKey}`, duration: Date.now() - start };
    }

    try {
      let result: unknown;

      switch (toolName) {
        case 'add_task': {
          const task = toolActor.addTask(params.title as string, params.description as string | undefined, params.priority as string | undefined);
          if (task) result = { message: `Task "${params.title}" added successfully`, task };
          else return { success: false, error: 'Failed to add task', duration: Date.now() - start };
          break;
        }

        case 'list_tasks': {
          const allTasks = toolActor.getTasks() as Array<{
            id?: string;
            title?: string;
            status?: string;
            priority?: string;
            claimedByEntityId?: string;
            claimedByName?: string;
          }>;
          const status = (params.status as string) || 'all';
          const tasks = status === 'all' ? allTasks : allTasks.filter(t => t.status === status);
          result = {
            total: allTasks.length,
            filtered: tasks.length,
            status,
            tasks: tasks.map(t => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              claimedByEntityId: t.claimedByEntityId,
              claimedByName: t.claimedByName,
            })),
          };
          break;
        }

        case 'get_task': {
          const task = toolActor.getTask(params.taskId as string);
          if (task) result = task;
          else return { success: false, error: `Task not found: ${params.taskId}`, duration: Date.now() - start };
          break;
        }

        default:
          return { success: false, error: `Unknown tool: ${toolName}`, duration: Date.now() - start };
      }

      return { success: true, result, duration: Date.now() - start };
    } catch (error) {
      return { success: false, error: String(error), duration: Date.now() - start };
    }
  }
}

