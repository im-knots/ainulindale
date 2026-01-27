/**
 * Plugin Registry - Central registry for all tool plugins
 *
 * The single source of truth for available tool types.
 * Plugins self-register, and the UI/engine queries this registry.
 */

import { ToolPlugin, ToolTemplate } from './plugin';
import { ToolResult } from './types';
import type { ExecutionContext } from './plugin';

/**
 * Plugin Registry
 *
 * Manages registration and lookup of tool plugins.
 * Provides methods for:
 * - Registration/unregistration
 * - Lookup by id or category
 * - Template generation for UI
 * - Tool execution delegation
 */
class PluginRegistryImpl {
  private plugins = new Map<string, ToolPlugin>();
  private initialized = false;

  /**
   * Register a plugin
   * @throws Error if plugin with same id already registered
   */
  register(plugin: ToolPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin '${plugin.id}' already registered`);
    }
    this.plugins.set(plugin.id, plugin);
    console.log(`[PluginRegistry] Registered plugin: ${plugin.id}`);
  }

  /**
   * Unregister a plugin by id
   */
  unregister(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (plugin?.dispose) {
      plugin.dispose().catch((err) => {
        console.error(`[PluginRegistry] Error disposing plugin ${id}:`, err);
      });
    }
    const deleted = this.plugins.delete(id);
    if (deleted) {
      console.log(`[PluginRegistry] Unregistered plugin: ${id}`);
    }
    return deleted;
  }

  /**
   * Get a plugin by id
   */
  get(id: string): ToolPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get all registered plugins
   */
  getAll(): ToolPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugins by category
   */
  getByCategory(category: string): ToolPlugin[] {
    return this.getAll().filter((p) => p.category === category);
  }

  /**
   * Get all available plugins (that pass isAvailable check)
   */
  getAvailable(): ToolPlugin[] {
    return this.getAll().filter((p) => p.isAvailable());
  }

  /**
   * Generate templates for UI (entity selector, etc.)
   * Only includes available plugins
   */
  getTemplates(): ToolTemplate[] {
    return this.getAvailable().map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      icon: plugin.icon,
      category: plugin.category,
      defaultConfig: plugin.defaultConfig,
      configSchema: plugin.configSchema,
    }));
  }

  /**
   * Check if a plugin is registered
   */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * Execute a tool on a plugin
   */
  async executeTool(
    pluginId: string,
    toolName: string,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const plugin = this.get(pluginId);

    if (!plugin) {
      return {
        success: false,
        error: `No plugin registered with id: ${pluginId}`,
      };
    }

    if (!plugin.isAvailable()) {
      return {
        success: false,
        error: `Plugin '${pluginId}' is not available in this environment`,
      };
    }

    return plugin.execute(toolName, params, context);
  }

  /**
   * Get all tools available from a specific plugin
   */
  getToolsForPlugin(pluginId: string): { name: string; description: string }[] {
    const plugin = this.get(pluginId);
    if (!plugin) return [];

    return plugin.getTools().map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  /**
   * Check if a specific tool is available
   */
  hasToolAvailable(pluginId: string, toolName: string): boolean {
    const plugin = this.get(pluginId);
    if (!plugin || !plugin.isAvailable()) return false;

    return plugin.getTools().some((t) => t.name === toolName);
  }

  /**
   * Mark registry as initialized (called after all plugins registered)
   */
  markInitialized(): void {
    this.initialized = true;
    console.log(
      `[PluginRegistry] Initialized with ${this.plugins.size} plugins`
    );
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistryImpl();

