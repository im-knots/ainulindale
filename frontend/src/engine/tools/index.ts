/**
 * Tools module - Tool plugins for hex entities
 */

export * from './types';

// Plugin system
export { pluginRegistry } from './plugin-registry';
export type { ToolPlugin, PluginCategory, PluginUIConfig, ExecutionContext } from './plugin';
export { registerBuiltinPlugins } from './plugins';

// Agent tools - RBAC-aware tool collection for agents
export { getAgentTools, executeAgentToolCall } from './agent-tools';
export type { AgentToolDefinition, ToolContext } from './agent-tools';

