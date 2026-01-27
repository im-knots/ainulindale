/**
 * Environment Context - Extracts environment information for agent prompts
 *
 * Gathers working directory, platform info, and other runtime context
 * from the agent's available tools and RBAC permissions.
 */

import { AppState, ToolEntity } from '../../state/store';
import { getResourcesInRange } from '../../hex/adjacency';
import { checkPermission } from '../../rbac/permissions';

export interface EnvironmentContext {
  /** Agent's entity UUID - used to identify claimed tasks */
  agentId: string;
  /** Agent's display name */
  agentName: string;
  workingDirectory?: string;
  platform: string;
  shellType?: string;
  availableWorkspaces: string[];
  currentDate: string;
}

/**
 * Get environment context for an agent based on its position and RBAC
 */
export function getEnvironmentContext(agentId: string, state: AppState): EnvironmentContext {
  // Look up agent entity to get name
  const agentEntity = state.entities.get(agentId);
  const agentName = agentEntity?.name || 'Unknown Agent';

  const context: EnvironmentContext = {
    agentId,
    agentName,
    platform: getPlatform(),
    availableWorkspaces: [],
    currentDate: formatCurrentDate(),
  };

  // Find agent's hex position
  let agentHexKey: string | null = null;
  for (const [key, hex] of state.hexes) {
    if (hex.entityId === agentId) {
      agentHexKey = key;
      break;
    }
  }

  if (!agentHexKey) {
    return context;
  }

  // Get resources in range
  const resources = getResourcesInRange(agentHexKey, state);

  for (const resource of resources) {
    const entity = state.entities.get(resource.entityId);
    if (!entity || entity.category !== 'tool') continue;

    const toolEntity = entity as ToolEntity;

    // Check for filesystem tools with read permission
    if (toolEntity.toolType === 'filesystem') {
      const permResult = checkPermission(agentHexKey, toolEntity, resource.hexKey, 'read');
      if (permResult.allowed && toolEntity.config?.rootPath) {
        const rootPath = toolEntity.config.rootPath as string;
        context.availableWorkspaces.push(rootPath);

        // Use first filesystem with write permission as primary working directory
        if (!context.workingDirectory) {
          const writeResult = checkPermission(agentHexKey, toolEntity, resource.hexKey, 'write');
          if (writeResult.allowed) {
            context.workingDirectory = rootPath;
          }
        }
      }
    }

    // Check for shell tools
    if (toolEntity.toolType === 'shell') {
      const permResult = checkPermission(agentHexKey, toolEntity, resource.hexKey, 'execute');
      if (permResult.allowed) {
        context.shellType = (toolEntity.config?.shell as string) || 'bash';
      }
    }
  }

  // If no write-capable filesystem, use first readable one
  if (!context.workingDirectory && context.availableWorkspaces.length > 0) {
    context.workingDirectory = context.availableWorkspaces[0];
  }

  return context;
}

/**
 * Get platform string
 */
function getPlatform(): string {
  // Check if running in Tauri
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    // Try to get OS from Tauri
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('mac')) return 'macOS';
    if (userAgent.includes('win')) return 'Windows';
    if (userAgent.includes('linux')) return 'Linux';
    return 'Desktop';
  }

  // Browser fallback
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('mac')) return 'macOS (browser)';
  if (userAgent.includes('win')) return 'Windows (browser)';
  if (userAgent.includes('linux')) return 'Linux (browser)';
  return 'Browser';
}

/**
 * Format current date as YYYY-MM-DD
 */
function formatCurrentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format environment context into prompt text
 * This appears at the top of the system prompt to ground the agent
 */
export function formatEnvironment(context: EnvironmentContext): string {
  const lines: string[] = [];

  // Agent identity first - so LLM knows who it is
  lines.push(`Agent ID: ${context.agentId}`);
  lines.push(`Agent Name: ${context.agentName}`);

  // Date - grounds the agent in time
  lines.push(`Today: ${context.currentDate}`);

  // Platform/OS
  lines.push(`Platform: ${context.platform}`);

  // Workspace directory if available
  if (context.workingDirectory) {
    lines.push(`Workspace: ${context.workingDirectory}`);
  }

  // Shell type if available
  if (context.shellType) {
    lines.push(`Shell: ${context.shellType}`);
  }

  return `## Environment\n\n${lines.join('\n')}`;
}

