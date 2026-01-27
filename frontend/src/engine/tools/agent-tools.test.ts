/**
 * Tests for agent-tools.ts - RBAC-aware tool collection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Store } from '../../state/store';
import { getAgentTools, executeAgentToolCall } from './agent-tools';
import { registerBuiltinPlugins } from './plugins';

// Mock window for provider availability checks - simulates Tauri environment
const mockWindow = {
  showDirectoryPicker: () => Promise.resolve({}),
  __TAURI_INTERNALS__: {}, // Required for plugins to report as available
};

// Register plugins once before all tests
registerBuiltinPlugins();

describe('agent-tools', () => {
  let store: Store;

  beforeEach(() => {
    // Mock window object for Node test environment with Tauri markers
    vi.stubGlobal('window', mockWindow);
    store = new Store();
    store.initializeGrid(3); // Medium grid for testing
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getAgentTools', () => {
    it('returns empty tools when agent is not on board', () => {
      const result = getAgentTools('non-existent-agent', store.getState());
      expect(result.tools).toEqual([]);
      expect(result.summary).toBe('No tools available (agent not on board)');
    });

    it('returns empty tools when agent has no adjacent tool hexes', () => {
      // Place an agent at center
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'coder',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        temperature: 0.7,
      });

      const state = store.getState();
      const agentId = state.hexes.get('0,0')!.entityId!;
      const result = getAgentTools(agentId, state);

      expect(result.tools).toEqual([]);
      expect(result.summary).toBe('No tools available. Place agent adjacent to tool hexes for access.');
    });

    it('finds tools from adjacent filesystem hex', () => {
      // Place agent at center
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'coder',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        temperature: 0.7,
      });

      // Place filesystem tool adjacent to agent
      store.placeEntity('1,0', {
        category: 'tool',
        toolType: 'filesystem',
        config: { basePath: './' },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const agentId = state.hexes.get('0,0')!.entityId!;
      const result = getAgentTools(agentId, state);

      expect(result.tools.length).toBeGreaterThan(0);
      expect(result.tools.some(t => t.sourceToolType === 'filesystem')).toBe(true);
      expect(result.summary).toContain('filesystem');
    });

    it('finds tools from multiple adjacent tool hexes', () => {
      // Place agent at center
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'coder',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        temperature: 0.7,
      });

      // Place filesystem tool adjacent
      store.placeEntity('1,0', {
        category: 'tool',
        toolType: 'filesystem',
        config: { basePath: './' },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      // Place shell tool adjacent
      store.placeEntity('0,1', {
        category: 'tool',
        toolType: 'shell',
        config: { cwd: './' },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const agentId = state.hexes.get('0,0')!.entityId!;
      const result = getAgentTools(agentId, state);

      expect(result.tools.length).toBeGreaterThan(0);
      expect(result.tools.some(t => t.sourceToolType === 'filesystem')).toBe(true);
      expect(result.tools.some(t => t.sourceToolType === 'shell')).toBe(true);
    });

    it('namespaces tool names with source type', () => {
      // Place agent at center
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'coder',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        temperature: 0.7,
      });

      // Place filesystem tool adjacent
      store.placeEntity('1,0', {
        category: 'tool',
        toolType: 'filesystem',
        config: { basePath: './' },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const agentId = state.hexes.get('0,0')!.entityId!;
      const result = getAgentTools(agentId, state);

      // Tool names should be namespaced like "filesystem_read_file"
      for (const tool of result.tools) {
        expect(tool.name).toMatch(/^filesystem_/);
      }
    });

    it('includes detailed tool information with parameter descriptions', () => {
      // Place agent at center
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'coder',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        temperature: 0.7,
      });

      // Place filesystem tool adjacent
      store.placeEntity('1,0', {
        category: 'tool',
        toolType: 'filesystem',
        config: { basePath: './' },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const agentId = state.hexes.get('0,0')!.entityId!;
      const result = getAgentTools(agentId, state);

      // Should have detailed tool info
      expect(result.detailedToolInfo).toBeDefined();
      expect(result.detailedToolInfo.length).toBeGreaterThan(0);

      // Should contain tool documentation
      expect(result.detailedToolInfo).toContain('Available Tools');
      expect(result.detailedToolInfo).toContain('filesystem');
    });
  });

  describe('executeAgentToolCall', () => {
    it('returns error when agent has no access to tool', async () => {
      // Place agent without any adjacent tools
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'coder',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        temperature: 0.7,
      });

      const state = store.getState();
      const agentId = state.hexes.get('0,0')!.entityId!;

      const result = await executeAgentToolCall(agentId, 'filesystem_read_file', {}, state);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });

  describe('tasklist tools', () => {
    it('discovers tasklist tools when agent is adjacent to tasklist hex', () => {
      // Place agent at center
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'planner',
        model: 'gpt-4o-mini',
        systemPrompt: 'You are a planner that breaks down tasks',
        temperature: 0.7,
      });

      // Place tasklist tool adjacent to agent
      store.placeEntity('1,0', {
        category: 'tool',
        toolType: 'tasklist',
        config: { tasks: [] },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const agentId = state.hexes.get('0,0')!.entityId!;
      const result = getAgentTools(agentId, state);

      // Should have tasklist tools available
      expect(result.tools.length).toBeGreaterThan(0);
      expect(result.tools.some(t => t.sourceToolType === 'tasklist')).toBe(true);

      // Should have the add_task tool
      const addTaskTool = result.tools.find(t => t.name === 'tasklist_add_task');
      expect(addTaskTool).toBeDefined();
      expect(addTaskTool?.description).toContain('Add a new task');

      // Should have the list_tasks tool
      const listTasksTool = result.tools.find(t => t.name === 'tasklist_list_tasks');
      expect(listTasksTool).toBeDefined();

      // Summary and detailed info should mention tasklist
      expect(result.summary).toContain('tasklist');
      expect(result.detailedToolInfo).toContain('tasklist');
    });

    it('includes tasklist tool info with tool descriptions', () => {
      // Place agent at center
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'planner',
        model: 'gpt-4o-mini',
        systemPrompt: '',
        temperature: 0.7,
      });

      // Place tasklist tool adjacent
      store.placeEntity('1,0', {
        category: 'tool',
        toolType: 'tasklist',
        config: { tasks: [] },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const agentId = state.hexes.get('0,0')!.entityId!;
      const result = getAgentTools(agentId, state);

      // Detailed info should contain tool descriptions
      expect(result.detailedToolInfo).toContain('tasklist_add_task');
      expect(result.detailedToolInfo).toContain('Add a new task');
      expect(result.detailedToolInfo).toContain('tasklist_list_tasks');
    });
  });
});

