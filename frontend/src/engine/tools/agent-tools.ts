/**
 * Agent Tools - Collects tools from adjacent tool hexes with RBAC filtering
 *
 * This module bridges the hex adjacency system with the AI SDK's tool system.
 * Agents get access to tools from tool hexes within range, with each tool
 * prefixed by its source hex ID for disambiguation.
 */

import { AppState, ToolEntity } from '../../state/store';
import { getResourcesInRange } from '../../hex/adjacency';
import { pluginRegistry } from './plugin-registry';
import { ZodToolDefinition, ToolResult } from './types';
import { truncateToolResult, TruncationConfig, DEFAULT_TRUNCATION_CONFIG } from './output-truncation';
import { checkPermission } from '../../rbac/permissions';
import { Permission } from '../../rbac/types';

/**
 * Extended tool definition that includes source context
 */
export interface AgentToolDefinition extends ZodToolDefinition {
  sourceHexId: string;      // ID of the tool entity providing this tool
  sourceHexName: string;    // Name of the tool entity
  sourceToolType: string;   // filesystem, shell, tasklist
  distance: number;         // Distance from agent to tool hex
  isExplicitLink: boolean;  // Whether this is via explicit linking
  config?: Record<string, unknown>;  // Tool entity configuration (e.g., workspacePath)
}

/**
 * Context about available tools for system prompt
 */
export interface ToolContext {
  tools: AgentToolDefinition[];
  summary: string;  // Human-readable summary for system prompt
  detailedToolInfo: string;  // Detailed tool descriptions with parameters for LLM context
}

/**
 * Compute working directory for a shell hex based on RBAC access to filesystem hexes.
 * Returns the rootPath of the first accessible filesystem hex, or null if none found.
 *
 * @param shellHexKey - The hex key where the shell tool is located
 * @param state - Current app state
 * @returns Working directory path or null
 */
function computeShellWorkingDirectory(shellHexKey: string, state: AppState): string | null {
  // Get all resources that the shell hex can access
  const resources = getResourcesInRange(shellHexKey, state);

  // Find the shell entity to use for permission checks
  const shellHex = state.hexes.get(shellHexKey);
  if (!shellHex?.entityId) return null;

  const shellEntity = state.entities.get(shellHex.entityId);
  if (!shellEntity) return null;

  // Look for filesystem hexes that the shell has execute permission to
  for (const resource of resources) {
    const entity = state.entities.get(resource.entityId);
    if (!entity || entity.category !== 'tool') continue;

    const toolEntity = entity as ToolEntity;
    if (toolEntity.toolType !== 'filesystem') continue;

    // Check if shell has execute permission to this filesystem
    const permResult = checkPermission(
      shellHexKey,
      toolEntity,
      resource.hexKey,
      'execute'
    );

    if (permResult.allowed) {
      const config = toolEntity.config as { rootPath?: string };
      if (config.rootPath) {
        console.log(`[Shell] Using filesystem working directory: ${config.rootPath} (from ${toolEntity.name})`);
        return config.rootPath;
      }
    }
  }

  return null;
}

/**
 * Get all tools available to an agent based on adjacency/range
 *
 * @param agentId - The agent entity ID
 * @param state - Current app state
 * @returns Tool definitions with source context
 */
export function getAgentTools(agentId: string, state: AppState): ToolContext {
  // Find which hex this agent is on
  let agentHexKey: string | null = null;
  for (const [key, hex] of state.hexes) {
    if (hex.entityId === agentId) {
      agentHexKey = key;
      break;
    }
  }

  if (!agentHexKey) {
    return { tools: [], summary: 'No tools available (agent not on board)', detailedToolInfo: '' };
  }

  // Get all tool resources that can reach this agent
  const resources = getResourcesInRange(agentHexKey, state);
  const tools: AgentToolDefinition[] = [];
  const toolSummaryParts: string[] = [];

  for (const resource of resources) {
    const toolEntity = state.entities.get(resource.entityId) as ToolEntity | undefined;
    if (!toolEntity || toolEntity.category !== 'tool') continue;

    // Get the plugin for this tool type
    const plugin = pluginRegistry.get(resource.type);
    if (!plugin || !plugin.isAvailable()) continue;

    // Get Zod tool definitions from plugin
    const zodTools = plugin.getZodTools?.();
    if (!zodTools || zodTools.length === 0) continue;

    // Apply any tool-specific config from the tool entity
    let config = { ...(toolEntity.config || {}) };

    // For shell tools, compute working directory based on RBAC access to filesystem hexes
    if (resource.type === 'shell') {
      const workingDir = computeShellWorkingDirectory(resource.hexKey, state);
      if (workingDir) {
        config.workingDirectory = workingDir;
      }
    }

    // Create namespaced tools from this plugin
    for (const zodTool of zodTools) {
      // Check RBAC permission for this specific tool
      const requiredPermission = getRequiredPermission(resource.type, zodTool.name);
      if (requiredPermission) {
        const permResult = checkPermission(
          agentHexKey,
          toolEntity,
          resource.hexKey,
          requiredPermission
        );
        if (!permResult.allowed) {
          // Skip this tool - agent doesn't have required permission
          console.log(`[getAgentTools] DENIED: ${resource.type}_${zodTool.name} (requires ${requiredPermission}): ${permResult.reason}`);
          continue;
        } else {
          console.log(`[getAgentTools] ALLOWED: ${resource.type}_${zodTool.name} (requires ${requiredPermission}): ${permResult.reason}`);
        }
      }

      // Namespace the tool name with the source hex for disambiguation
      // e.g., "filesystem_abc123_read_file" or just "read_file" if only one source
      const namespacedName = `${resource.type}_${zodTool.name}`;

      // Create execute function that applies tool entity config
      const executeWithConfig = async (params: Record<string, unknown>): Promise<ToolResult> => {
        // Merge tool entity config with call params (call params take precedence)
        // Include _sourceHexKey so tasklist tools can find the correct ToolActor
        const mergedParams = { ...config, ...params, _sourceHexKey: resource.hexKey };
        return zodTool.execute(mergedParams);
      };

      // Build enhanced description - no hex name prefix since tools are grouped by source
      // The section header already indicates which hex provides the tool
      let enhancedDescription = zodTool.description;

      // For filesystem tools, include workspace path in description
      if (resource.type === 'filesystem' && config.workspacePath) {
        enhancedDescription += ` (workspace: ${config.workspacePath})`;
      }

      // For shell tools, include working directory in description
      if (resource.type === 'shell' && config.workingDirectory) {
        enhancedDescription += ` (working directory: ${config.workingDirectory})`;
      }

      tools.push({
        ...zodTool,
        name: namespacedName,
        description: enhancedDescription,
        execute: executeWithConfig,
        sourceHexId: resource.entityId,
        sourceHexName: toolEntity.name,
        sourceToolType: resource.type,
        distance: resource.distance,
        isExplicitLink: resource.isExplicitLink,
        config, // Include config for detailed tool info
      });
    }

    // Build summary for this tool source
    const distanceInfo = resource.isExplicitLink ? 'linked' : `range ${resource.distance}`;
    toolSummaryParts.push(`- ${toolEntity.name} (${resource.type}, ${distanceInfo}): ${zodTools.length} tools`);
  }

  const summary = toolSummaryParts.length > 0
    ? `Available tools from ${toolSummaryParts.length} connected tool hex(es):\n${toolSummaryParts.join('\n')}`
    : 'No tools available. Place agent adjacent to tool hexes for access.';

  // Build detailed tool information for LLM context
  const detailedToolInfo = buildDetailedToolInfo(tools);

  return { tools, summary, detailedToolInfo };
}

/**
 * Build detailed tool information for LLM context.
 * Includes tool names, descriptions, parameters, and usage examples.
 */
function buildDetailedToolInfo(tools: AgentToolDefinition[]): string {
  if (tools.length === 0) {
    return '';
  }

  const sections: string[] = [];
  sections.push('## Available Tools\n');
  sections.push('You have access to the following tools. Call them using their exact names.\n');

  // Group tools by source
  const toolsBySource = new Map<string, AgentToolDefinition[]>();
  for (const tool of tools) {
    const key = `${tool.sourceHexName} (${tool.sourceToolType})`;
    if (!toolsBySource.has(key)) {
      toolsBySource.set(key, []);
    }
    toolsBySource.get(key)!.push(tool);
  }

  for (const [source, sourceTools] of toolsBySource) {
    sections.push(`### ${source}\n`);

    // Add workspace path info prominently for filesystem tools
    const firstTool = sourceTools[0];
    if (firstTool.sourceToolType === 'filesystem' && firstTool.config?.workspacePath) {
      sections.push(`**Workspace Directory**: \`${firstTool.config.workspacePath}\``);
      sections.push('All file paths are relative to this workspace directory.\n');
    }

    for (const tool of sourceTools) {
      sections.push(`**${tool.name}**`);
      sections.push(`${tool.description}\n`);

      // Extract parameter info from schema
      const params = extractParameterInfo(tool.schema);
      if (params.length > 0) {
        sections.push('Parameters:');
        for (const param of params) {
          const requiredMarker = param.required ? ' (required)' : ' (optional)';
          sections.push(`- \`${param.name}\`${requiredMarker}: ${param.description}`);
        }
        sections.push('');
      }
    }
  }

  return sections.join('\n');
}

/**
 * Extract parameter information from a Zod schema
 */
interface ParameterInfo {
  name: string;
  description: string;
  required: boolean;
  type: string;
}

function extractParameterInfo(schema: unknown): ParameterInfo[] {
  const params: ParameterInfo[] = [];

  // Handle Zod schema - try to extract shape
  if (schema && typeof schema === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const zodSchema = schema as any;

    // Check if it's a Zod object schema
    if (zodSchema._def?.typeName === 'ZodObject' && zodSchema._def?.shape) {
      const shape = typeof zodSchema._def.shape === 'function'
        ? zodSchema._def.shape()
        : zodSchema._def.shape;

      for (const [key, fieldSchema] of Object.entries(shape)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const field = fieldSchema as any;
        const description = field._def?.description || field.description || 'No description';
        const isOptional = field._def?.typeName === 'ZodOptional' ||
                          field._def?.typeName === 'ZodDefault' ||
                          field.isOptional?.() === true;
        const typeName = getZodTypeName(field);

        params.push({
          name: key,
          description,
          required: !isOptional,
          type: typeName,
        });
      }
    }
  }

  return params;
}

/**
 * Get a human-readable type name from a Zod schema
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getZodTypeName(schema: any): string {
  if (!schema?._def?.typeName) return 'unknown';

  const typeName = schema._def.typeName;
  switch (typeName) {
    case 'ZodString': return 'string';
    case 'ZodNumber': return 'number';
    case 'ZodBoolean': return 'boolean';
    case 'ZodArray': return 'array';
    case 'ZodObject': return 'object';
    case 'ZodOptional': return getZodTypeName(schema._def.innerType) + '?';
    case 'ZodDefault': return getZodTypeName(schema._def.innerType);
    case 'ZodEnum': return `enum(${schema._def.values?.join(' | ') || '...'})`;
    default: return typeName.replace('Zod', '').toLowerCase();
  }
}

/**
 * Options for tool call execution
 */
export interface ExecuteToolCallOptions {
  /** Custom truncation config to override defaults */
  truncationConfig?: Partial<TruncationConfig>;
  /** Disable truncation entirely */
  disableTruncation?: boolean;
}

/**
 * Execute a tool call from an agent, applying RBAC checks and output truncation
 *
 * @param agentId - The agent entity ID
 * @param toolName - Namespaced tool name (e.g., "filesystem_read_file")
 * @param params - Tool parameters
 * @param state - Current app state
 * @param options - Optional execution options
 * @returns Tool result with truncation applied
 */
export async function executeAgentToolCall(
  agentId: string,
  toolName: string,
  params: Record<string, unknown>,
  state: AppState,
  options: ExecuteToolCallOptions = {}
): Promise<ToolResult> {
  // Get available tools for this agent
  const { tools } = getAgentTools(agentId, state);

  // Find the requested tool
  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    return {
      success: false,
      error: `Tool "${toolName}" not available. Check that the agent is adjacent to a tool hex providing this capability.`,
    };
  }

  // Execute the tool
  const startTime = Date.now();
  try {
    const result = await tool.execute(params);
    const duration = Date.now() - startTime;

    // Apply output truncation if enabled and successful
    if (result.success && result.result !== undefined && !options.disableTruncation) {
      const { result: truncatedResult, truncationInfo } = truncateToolResult(
        result.result,
        tool.sourceToolType,
        options.truncationConfig
      );

      return {
        ...result,
        result: truncatedResult,
        duration,
        // Include truncation metadata for debugging/logging
        ...(truncationInfo && {
          truncated: true,
          originalLength: truncationInfo.originalLength,
        }),
      };
    }

    return {
      ...result,
      duration,
    };
  } catch (error) {
    return {
      success: false,
      error: `Tool execution failed: ${error}`,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get truncation config for a specific tool type
 */
export function getTruncationConfig(toolType: string): TruncationConfig {
  return {
    ...DEFAULT_TRUNCATION_CONFIG.default,
    ...DEFAULT_TRUNCATION_CONFIG[toolType],
  };
}

/**
 * Map of tool names to required permissions
 * Tools not in this map are assumed to require 'execute' by default
 */
const TOOL_PERMISSION_MAP: Record<string, Record<string, Permission>> = {
  tasklist: {
    add_task: 'write',
    list_tasks: 'read',
    get_task: 'read',
  },
  filesystem: {
    // Read operations
    read_file: 'read',
    list_directory: 'read',
    search_files: 'read',
    file_exists: 'read',
    get_file_info: 'read',
    // Write operations
    write_file: 'write',
    create_directory: 'write',
    delete_file: 'write',
    delete_directory: 'write',
    copy_file: 'write',
    move_file: 'write',
    // Execute operations (compute-intensive)
    codebase_search: 'execute',
  },
  shell: {
    run_command: 'execute',
  },
};

/**
 * Get the required permission for a specific tool
 */
function getRequiredPermission(toolType: string, toolName: string): Permission | undefined {
  const toolMap = TOOL_PERMISSION_MAP[toolType];
  if (toolMap && toolName in toolMap) {
    return toolMap[toolName];
  }
  // Default to execute for unknown tools
  return 'execute';
}
