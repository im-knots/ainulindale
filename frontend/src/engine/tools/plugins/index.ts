/**
 * Tool Plugins - Export all built-in plugins
 *
 * This module exports all built-in tool plugins and provides
 * a function to register them with the plugin registry.
 */

import { pluginRegistry } from '../plugin-registry';
import { FilesystemPlugin } from './filesystem-plugin';
import { ShellPlugin } from './shell-plugin';
import { TasklistPlugin, setToolActorGetter, clearToolActorGetter } from './tasklist-plugin';

// Re-export tasklist plugin functions for BoardRunner
export { setToolActorGetter, clearToolActorGetter };

// Export plugin classes
export { FilesystemPlugin, ShellPlugin, TasklistPlugin };

/**
 * Register all built-in plugins with the registry.
 * Called during app initialization.
 */
export function registerBuiltinPlugins(): void {
  console.log('[Plugins] Registering built-in plugins...');
  
  pluginRegistry.register(new FilesystemPlugin());
  pluginRegistry.register(new ShellPlugin());
  pluginRegistry.register(new TasklistPlugin());
  
  console.log(`[Plugins] Registered ${pluginRegistry.getAll().length} plugins`);
}

/**
 * Get the list of available plugin IDs
 */
export function getAvailablePluginIds(): string[] {
  return pluginRegistry.getAvailable().map(p => p.id);
}

