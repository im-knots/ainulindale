/**
 * Filesystem Plugin - Local file system access
 *
 * Converts FilesystemProvider to the plugin interface.
 * Uses Tauri commands for native filesystem access.
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

// Safe default working directory to avoid accidentally running in Tauri's directory
const SAFE_DEFAULT_WORKING_DIR = '/tmp';

// Directory entry type from Tauri
interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_file: boolean;
  size: number;
}

// Zod schemas for filesystem tools
const readFileSchema = z.object({
  path: z.string().describe('Path to the file to read'),
});

const writeFileSchema = z.object({
  path: z.string().describe('Path to the file to write'),
  content: z.string().describe('Content to write to the file'),
});

const listDirectorySchema = z.object({
  path: z.string().describe('Directory path to list'),
});

const searchFilesSchema = z.object({
  pattern: z.string().describe('Search pattern (glob-like, e.g., "*.ts" or "test*")'),
  path: z.string().optional().default('.').describe('Directory to search in'),
});

const deleteFileSchema = z.object({
  path: z.string().describe('Path to the file to delete'),
});

const deleteDirectorySchema = z.object({
  path: z.string().describe('Path to the directory to delete (recursive)'),
});

const copyFileSchema = z.object({
  source: z.string().describe('Source file path'),
  destination: z.string().describe('Destination file path'),
});

const moveFileSchema = z.object({
  source: z.string().describe('Source file or directory path'),
  destination: z.string().describe('Destination path'),
});

const createDirectorySchema = z.object({
  path: z.string().describe('Directory path to create (creates parent directories as needed)'),
});

const fileExistsSchema = z.object({
  path: z.string().describe('Path to check for existence'),
});

const getFileInfoSchema = z.object({
  path: z.string().describe('Path to get metadata for'),
});

const codebaseSearchSchema = z.object({
  query: z.string().describe('Natural language query to search the codebase'),
  limit: z.number().optional().default(10).describe('Maximum number of results to return'),
});

// Configuration schema for the filesystem plugin
const configSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    rootPath: {
      type: 'string',
      title: 'Root Path',
      description: 'Base directory for all file operations. Relative paths are resolved from here.',
      default: '/tmp',
    },
  },
  required: [],
};

/**
 * Check if running in Tauri environment
 */
function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Filesystem Plugin implementation
 */
export class FilesystemPlugin implements ToolPlugin {
  // === Identity ===
  id = 'filesystem';
  name = 'Filesystem';
  description = 'Local file system access - read, write, list, and search files';
  icon = 'folder';
  category: PluginCategory = 'local';

  // === Configuration ===
  configSchema = configSchema;
  defaultConfig = { rootPath: SAFE_DEFAULT_WORKING_DIR };

  // === UI Configuration ===
  // Filesystem has a config panel but no detail bar tabs
  ui: PluginUIConfig = {
    hasConfigPanel: true,
  };

  private config: { rootPath?: string } = {};

  validateConfig(config: unknown): ValidationResult {
    if (typeof config !== 'object' || config === null) {
      return { valid: false, errors: [{ field: 'config', message: 'Configuration must be an object' }] };
    }
    const cfg = config as Record<string, unknown>;
    if (cfg.rootPath !== undefined && typeof cfg.rootPath !== 'string') {
      return { valid: false, errors: [{ field: 'rootPath', message: 'Root path must be a string' }] };
    }
    return { valid: true };
  }

  // === Environment ===
  isAvailable(): boolean {
    return isTauriEnvironment();
  }

  // === Lifecycle ===
  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = { rootPath: (config.rootPath as string) || SAFE_DEFAULT_WORKING_DIR };
    console.log(`[FilesystemPlugin] Initialized with rootPath: ${this.config.rootPath}`);
  }

  // === Capabilities ===
  getTools(): ToolDefinition[] {
    return [
      { name: 'read_file', description: 'Read the contents of a file', parameters: zodToJsonSchema(readFileSchema) },
      { name: 'write_file', description: 'Write content to a file', parameters: zodToJsonSchema(writeFileSchema) },
      { name: 'list_directory', description: 'List files and directories', parameters: zodToJsonSchema(listDirectorySchema) },
      { name: 'search_files', description: 'Search for files matching a pattern', parameters: zodToJsonSchema(searchFilesSchema) },
      { name: 'delete_file', description: 'Delete a file', parameters: zodToJsonSchema(deleteFileSchema) },
      { name: 'delete_directory', description: 'Delete a directory recursively', parameters: zodToJsonSchema(deleteDirectorySchema) },
      { name: 'copy_file', description: 'Copy a file to a new location', parameters: zodToJsonSchema(copyFileSchema) },
      { name: 'move_file', description: 'Move or rename a file or directory', parameters: zodToJsonSchema(moveFileSchema) },
      { name: 'create_directory', description: 'Create a directory', parameters: zodToJsonSchema(createDirectorySchema) },
      { name: 'file_exists', description: 'Check if a file or directory exists', parameters: zodToJsonSchema(fileExistsSchema) },
      { name: 'get_file_info', description: 'Get metadata about a file or directory', parameters: zodToJsonSchema(getFileInfoSchema) },
      { name: 'codebase_search', description: 'Semantic search across the indexed codebase', parameters: zodToJsonSchema(codebaseSearchSchema) },
    ];
  }

  getZodTools(): ZodToolDefinition[] {
    return [
      { name: 'read_file', description: 'Read the contents of a file', schema: readFileSchema, execute: async (p) => this.execute('read_file', p, {} as ExecutionContext) },
      { name: 'write_file', description: 'Write content to a file', schema: writeFileSchema, execute: async (p) => this.execute('write_file', p, {} as ExecutionContext) },
      { name: 'list_directory', description: 'List files and directories', schema: listDirectorySchema, execute: async (p) => this.execute('list_directory', p, {} as ExecutionContext) },
      { name: 'search_files', description: 'Search for files matching a pattern', schema: searchFilesSchema, execute: async (p) => this.execute('search_files', p, {} as ExecutionContext) },
      { name: 'delete_file', description: 'Delete a file', schema: deleteFileSchema, execute: async (p) => this.execute('delete_file', p, {} as ExecutionContext) },
      { name: 'delete_directory', description: 'Delete a directory recursively', schema: deleteDirectorySchema, execute: async (p) => this.execute('delete_directory', p, {} as ExecutionContext) },
      { name: 'copy_file', description: 'Copy a file to a new location', schema: copyFileSchema, execute: async (p) => this.execute('copy_file', p, {} as ExecutionContext) },
      { name: 'move_file', description: 'Move or rename a file or directory', schema: moveFileSchema, execute: async (p) => this.execute('move_file', p, {} as ExecutionContext) },
      { name: 'create_directory', description: 'Create a directory', schema: createDirectorySchema, execute: async (p) => this.execute('create_directory', p, {} as ExecutionContext) },
      { name: 'file_exists', description: 'Check if a file or directory exists', schema: fileExistsSchema, execute: async (p) => this.execute('file_exists', p, {} as ExecutionContext) },
      { name: 'get_file_info', description: 'Get metadata about a file or directory', schema: getFileInfoSchema, execute: async (p) => this.execute('get_file_info', p, {} as ExecutionContext) },
      { name: 'codebase_search', description: 'Semantic search across the indexed codebase', schema: codebaseSearchSchema, execute: async (p) => this.execute('codebase_search', p, {} as ExecutionContext) },
    ];
  }

  async execute(toolName: string, params: Record<string, unknown>, _context: ExecutionContext): Promise<ToolResult> {
    const start = Date.now();
    const workspaceRoot = (params.workspacePath as string) || (params.rootPath as string) || this.config.rootPath || SAFE_DEFAULT_WORKING_DIR;

    try {
      let result: unknown;
      switch (toolName) {
        case 'read_file': result = await this.readFile(params.path as string, workspaceRoot); break;
        case 'write_file': result = await this.writeFile(params.path as string, params.content as string, workspaceRoot); break;
        case 'list_directory': result = await this.listDirectory(params.path as string, workspaceRoot); break;
        case 'search_files': result = await this.searchFiles(params.pattern as string, (params.path as string) || '.', workspaceRoot); break;
        case 'delete_file': result = await this.deleteFile(params.path as string, workspaceRoot); break;
        case 'delete_directory': result = await this.deleteDirectory(params.path as string, workspaceRoot); break;
        case 'copy_file': result = await this.copyFile(params.source as string, params.destination as string, workspaceRoot); break;
        case 'move_file': result = await this.moveFile(params.source as string, params.destination as string, workspaceRoot); break;
        case 'create_directory': result = await this.createDirectory(params.path as string, workspaceRoot); break;
        case 'file_exists': result = await this.fileExists(params.path as string, workspaceRoot); break;
        case 'get_file_info': result = await this.getFileInfo(params.path as string, workspaceRoot); break;
        case 'codebase_search': result = await this.codebaseSearch(params.query as string, params.filesystemHexId as string | undefined, (params.limit as number) || 10); break;
        default: return { success: false, error: `Unknown tool: ${toolName}`, duration: Date.now() - start };
      }
      return { success: true, result, duration: Date.now() - start };
    } catch (error) {
      return { success: false, error: String(error), duration: Date.now() - start };
    }
  }

  // === Private helper methods ===
  private resolvePath(path: string, workspaceRoot?: string): string {
    const root = workspaceRoot || this.config.rootPath;
    if (root && !path.startsWith('/')) {
      return `${root}/${path}`;
    }
    return path;
  }

  private async readFile(path: string, workspaceRoot?: string): Promise<string> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedPath = this.resolvePath(path, workspaceRoot);
    console.log(`[FilesystemPlugin] Reading file: ${resolvedPath}`);
    return invoke<string>('read_file', { path: resolvedPath });
  }

  private async writeFile(path: string, content: string, workspaceRoot?: string): Promise<{ written: number }> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedPath = this.resolvePath(path, workspaceRoot);
    console.log(`[FilesystemPlugin] Writing file: ${resolvedPath} (${content.length} chars)`);
    await invoke('write_file', { path: resolvedPath, contents: content });
    return { written: content.length };
  }

  private async listDirectory(path: string, workspaceRoot?: string): Promise<{ entries: { name: string; type: 'file' | 'directory'; size: number }[] }> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedPath = this.resolvePath(path, workspaceRoot);
    const dirEntries = await invoke<DirEntry[]>('list_directory', { path: resolvedPath });
    return { entries: dirEntries.map(e => ({ name: e.name, type: e.is_dir ? 'directory' as const : 'file' as const, size: e.size })) };
  }

  private async searchFiles(pattern: string, basePath: string, workspaceRoot?: string): Promise<{ matches: string[] }> {
    const matches: string[] = [];
    await this.searchRecursive(basePath, pattern, matches, 0, workspaceRoot);
    return { matches };
  }

  private async searchRecursive(path: string, pattern: string, matches: string[], depth: number, workspaceRoot?: string): Promise<void> {
    if (depth > 10) return;
    const { entries } = await this.listDirectory(path, workspaceRoot);
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    for (const entry of entries) {
      const fullPath = path === '.' ? entry.name : `${path}/${entry.name}`;
      if (entry.type === 'file' && regex.test(entry.name)) matches.push(fullPath);
      else if (entry.type === 'directory' && !entry.name.startsWith('.')) await this.searchRecursive(fullPath, pattern, matches, depth + 1, workspaceRoot);
    }
  }

  private async deleteFile(path: string, workspaceRoot?: string): Promise<{ deleted: string }> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedPath = this.resolvePath(path, workspaceRoot);
    await invoke('delete_file', { path: resolvedPath });
    return { deleted: resolvedPath };
  }

  private async deleteDirectory(path: string, workspaceRoot?: string): Promise<{ deleted: string }> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedPath = this.resolvePath(path, workspaceRoot);
    await invoke('delete_directory', { path: resolvedPath });
    return { deleted: resolvedPath };
  }

  private async copyFile(source: string, destination: string, workspaceRoot?: string): Promise<{ source: string; destination: string; bytesCopied: number }> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedSource = this.resolvePath(source, workspaceRoot);
    const resolvedDest = this.resolvePath(destination, workspaceRoot);
    const bytesCopied = await invoke<number>('copy_file', { source: resolvedSource, destination: resolvedDest });
    return { source: resolvedSource, destination: resolvedDest, bytesCopied };
  }

  private async moveFile(source: string, destination: string, workspaceRoot?: string): Promise<{ source: string; destination: string }> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedSource = this.resolvePath(source, workspaceRoot);
    const resolvedDest = this.resolvePath(destination, workspaceRoot);
    await invoke('move_file', { source: resolvedSource, destination: resolvedDest });
    return { source: resolvedSource, destination: resolvedDest };
  }

  private async createDirectory(path: string, workspaceRoot?: string): Promise<{ created: string }> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedPath = this.resolvePath(path, workspaceRoot);
    await invoke('create_directory', { path: resolvedPath });
    return { created: resolvedPath };
  }

  private async fileExists(path: string, workspaceRoot?: string): Promise<{ path: string; exists: boolean }> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedPath = this.resolvePath(path, workspaceRoot);
    const exists = await invoke<boolean>('file_exists', { path: resolvedPath });
    return { path: resolvedPath, exists };
  }

  private async getFileInfo(path: string, workspaceRoot?: string): Promise<FileInfo> {
    if (!isTauriEnvironment()) throw new Error('Filesystem access requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const resolvedPath = this.resolvePath(path, workspaceRoot);
    return invoke<FileInfo>('get_file_info', { path: resolvedPath });
  }

  private async codebaseSearch(query: string, filesystemHexId?: string, limit: number = 10): Promise<CodebaseSearchResult> {
    if (!isTauriEnvironment()) throw new Error('Codebase search requires Tauri environment');
    const { invoke } = await import('@tauri-apps/api/core');
    const isReady = await invoke<boolean>('indexer_is_ready');
    if (!isReady) await invoke('indexer_initialize');
    const request: SearchRequest = { query, filesystem_hex_ids: filesystemHexId ? [filesystemHexId] : [], limit };
    const results = await invoke<SearchResultItem[]>('indexer_search', { request });
    return {
      query,
      resultCount: results.length,
      results: results.map(r => ({
        filePath: r.chunk.file_path,
        startLine: r.chunk.start_line,
        endLine: r.chunk.end_line,
        content: r.chunk.content,
        distance: r.distance,
        relevance: 1 - r.distance,
      })),
    };
  }
}

// Type definitions
interface FileInfo { path: string; exists: boolean; is_file: boolean; is_dir: boolean; size: number; modified: number | null; created: number | null; readonly: boolean; }
interface SearchRequest { query: string; filesystem_hex_ids: string[]; limit?: number; }
interface CodeChunk { id: string; filesystem_hex_id: string; file_path: string; start_line: number; end_line: number; content: string; language?: string; }
interface SearchResultItem { chunk: CodeChunk; distance: number; }
interface CodebaseSearchResult { query: string; resultCount: number; results: { filePath: string; startLine: number; endLine: number; content: string; distance: number; relevance: number; }[]; }

