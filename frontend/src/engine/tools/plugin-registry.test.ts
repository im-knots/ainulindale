/**
 * Tests for Plugin Registry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pluginRegistry } from './plugin-registry';
import { ToolPlugin, ValidationResult, PluginCategory } from './plugin';
import { ToolDefinition, ToolResult } from './types';

// Create a mock plugin for testing
function createMockPlugin(overrides: Partial<ToolPlugin> = {}): ToolPlugin {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    description: 'A test plugin',
    icon: '<svg>test</svg>',
    category: 'local' as PluginCategory,
    configSchema: { type: 'object', properties: {} },
    defaultConfig: {},
    validateConfig: (): ValidationResult => ({ valid: true }),
    getTools: (): ToolDefinition[] => [
      { name: 'test_tool', description: 'A test tool', parameters: { type: 'object' } },
    ],
    execute: async (): Promise<ToolResult> => ({ success: true, result: 'test' }),
    isAvailable: () => true,
    ...overrides,
  };
}

describe('PluginRegistry', () => {
  // Note: We can't easily reset the singleton, so tests need to use unique plugin IDs

  describe('register', () => {
    it('registers a plugin successfully', () => {
      const plugin = createMockPlugin({ id: 'register-test-1' });
      
      // Should not throw
      pluginRegistry.register(plugin);
      
      expect(pluginRegistry.has('register-test-1')).toBe(true);
    });

    it('throws error when registering duplicate plugin id', () => {
      const plugin1 = createMockPlugin({ id: 'duplicate-test' });
      const plugin2 = createMockPlugin({ id: 'duplicate-test', name: 'Different Name' });
      
      pluginRegistry.register(plugin1);
      
      expect(() => pluginRegistry.register(plugin2)).toThrow("Plugin 'duplicate-test' already registered");
    });
  });

  describe('get', () => {
    it('returns undefined for non-existent plugin', () => {
      expect(pluginRegistry.get('non-existent-plugin')).toBeUndefined();
    });

    it('returns registered plugin', () => {
      const plugin = createMockPlugin({ id: 'get-test-1' });
      pluginRegistry.register(plugin);
      
      expect(pluginRegistry.get('get-test-1')).toBe(plugin);
    });
  });

  describe('getAll', () => {
    it('returns all registered plugins', () => {
      const plugin1 = createMockPlugin({ id: 'getall-test-1' });
      const plugin2 = createMockPlugin({ id: 'getall-test-2' });
      
      pluginRegistry.register(plugin1);
      pluginRegistry.register(plugin2);
      
      const all = pluginRegistry.getAll();
      const ids = all.map((p) => p.id);
      
      expect(ids).toContain('getall-test-1');
      expect(ids).toContain('getall-test-2');
    });
  });

  describe('getByCategory', () => {
    it('filters plugins by category', () => {
      const localPlugin = createMockPlugin({ id: 'category-local', category: 'local' });
      const integrationPlugin = createMockPlugin({ id: 'category-integration', category: 'integration' });
      
      pluginRegistry.register(localPlugin);
      pluginRegistry.register(integrationPlugin);
      
      const localPlugins = pluginRegistry.getByCategory('local');
      const integrationPlugins = pluginRegistry.getByCategory('integration');
      
      expect(localPlugins.map((p) => p.id)).toContain('category-local');
      expect(integrationPlugins.map((p) => p.id)).toContain('category-integration');
    });
  });

  describe('getTemplates', () => {
    it('generates templates from available plugins', () => {
      const plugin = createMockPlugin({ 
        id: 'template-test', 
        name: 'Template Test',
        description: 'A template test plugin',
        icon: '<svg>icon</svg>',
        category: 'data',
        defaultConfig: { setting: 'value' },
      });
      
      pluginRegistry.register(plugin);
      
      const templates = pluginRegistry.getTemplates();
      const template = templates.find((t) => t.id === 'template-test');
      
      expect(template).toBeDefined();
      expect(template?.name).toBe('Template Test');
      expect(template?.description).toBe('A template test plugin');
      expect(template?.category).toBe('data');
      expect(template?.defaultConfig).toEqual({ setting: 'value' });
    });

    it('excludes unavailable plugins from templates', () => {
      const unavailablePlugin = createMockPlugin({ 
        id: 'unavailable-test',
        isAvailable: () => false,
      });
      
      pluginRegistry.register(unavailablePlugin);
      
      const templates = pluginRegistry.getTemplates();
      const template = templates.find((t) => t.id === 'unavailable-test');
      
      expect(template).toBeUndefined();
    });
  });

  describe('executeTool', () => {
    it('executes tool on registered plugin', async () => {
      const executeMock = vi.fn().mockResolvedValue({ success: true, result: 'executed' });
      const plugin = createMockPlugin({ id: 'execute-test', execute: executeMock });
      
      pluginRegistry.register(plugin);
      
      const context = {
        entityId: 'entity-1',
        hexKey: 'hex-0-0',
        boardId: 'board-1',
        eventBus: {} as any,
        emit: () => {},
      };
      
      const result = await pluginRegistry.executeTool('execute-test', 'test_tool', { param: 'value' }, context);
      
      expect(result.success).toBe(true);
      expect(result.result).toBe('executed');
      expect(executeMock).toHaveBeenCalledWith('test_tool', { param: 'value' }, context);
    });

    it('returns error for non-existent plugin', async () => {
      const context = {
        entityId: 'entity-1',
        hexKey: 'hex-0-0',
        boardId: 'board-1',
        eventBus: {} as any,
        emit: () => {},
      };
      
      const result = await pluginRegistry.executeTool('non-existent', 'tool', {}, context);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No plugin registered');
    });
  });
});

