import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../state/store';
import {
  getAdjacentEntities,
  getResourcesInRange,
  getEntityCapabilities,
  areHexesAdjacent,
} from './adjacency';

describe('adjacency', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    // Initialize a test grid
    store.initializeGrid(2); // Small grid for testing
  });

  describe('areHexesAdjacent', () => {
    it('returns true for adjacent hexes', () => {
      expect(areHexesAdjacent('0,0', '1,0')).toBe(true);
      expect(areHexesAdjacent('0,0', '0,1')).toBe(true);
      expect(areHexesAdjacent('0,0', '-1,1')).toBe(true);
    });

    it('returns false for non-adjacent hexes', () => {
      expect(areHexesAdjacent('0,0', '2,0')).toBe(false);
      expect(areHexesAdjacent('0,0', '0,2')).toBe(false);
    });

    it('returns false for same hex', () => {
      expect(areHexesAdjacent('0,0', '0,0')).toBe(false);
    });
  });

  describe('getAdjacentEntities', () => {
    it('returns empty array when no entities are adjacent', () => {
      const state = store.getState();
      const adjacent = getAdjacentEntities('0,0', state);
      expect(adjacent).toEqual([]);
    });

    it('finds entities on adjacent hexes', () => {
      // Place an entity at 1,0 (adjacent to 0,0)
      store.placeEntity('1,0', {
        category: 'agent',
        template: 'planner',
        model: 'gpt-4',
        systemPrompt: '',
        temperature: 0.7,
      });

      const state = store.getState();
      const adjacent = getAdjacentEntities('0,0', state);

      expect(adjacent).toHaveLength(1);
      expect(adjacent[0].category).toBe('agent');
    });

    it('finds multiple adjacent entities', () => {
      // Place entities on two adjacent hexes
      store.placeEntity('1,0', {
        category: 'agent',
        template: 'planner',
        model: 'gpt-4',
        systemPrompt: '',
        temperature: 0.7,
      });
      store.placeEntity('0,1', {
        category: 'tool',
        toolType: 'filesystem',
        config: { basePath: './' },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const adjacent = getAdjacentEntities('0,0', state);

      expect(adjacent).toHaveLength(2);
    });
  });

  describe('getResourcesInRange', () => {
    it('returns empty when no tools adjacent', () => {
      const state = store.getState();
      const resources = getResourcesInRange('0,0', state);
      expect(resources).toEqual([]);
    });

    it('finds adjacent filesystem tools', () => {
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
      const resources = getResourcesInRange('0,0', state);

      expect(resources).toHaveLength(1);
      expect(resources[0].type).toBe('filesystem');
    });

    it('finds adjacent shell tools', () => {
      store.placeEntity('1,0', {
        category: 'tool',
        toolType: 'shell',
        config: { cwd: './' },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const resources = getResourcesInRange('0,0', state);

      expect(resources).toHaveLength(1);
      expect(resources[0].type).toBe('shell');
    });

    it('finds adjacent tasklist tools', () => {
      store.placeEntity('0,1', {
        category: 'tool',
        toolType: 'tasklist',
        config: { filePath: './tasks.md' },
        isConfigured: true,
        range: 1,
        linkingMode: 'range',
        linkedHexes: [],
      });

      const state = store.getState();
      const resources = getResourcesInRange('0,0', state);

      expect(resources).toHaveLength(1);
      expect(resources[0].type).toBe('tasklist');
    });
  });

  describe('getEntityCapabilities', () => {
    it('returns empty capabilities for entity with no adjacent tools', () => {
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'coder',
        model: 'claude-3',
        systemPrompt: '',
        temperature: 0.5,
      });

      const state = store.getState();
      const hex = state.hexes.get('0,0');
      const capabilities = getEntityCapabilities(hex!.entityId!, state);

      expect(capabilities.tools).toEqual([]);
      expect(capabilities.adjacentAgents).toEqual([]);
    });

    it('aggregates capabilities from all adjacent tools', () => {
      // Place agent at center
      store.placeEntity('0,0', {
        category: 'agent',
        template: 'coder',
        model: 'claude-3',
        systemPrompt: '',
        temperature: 0.5,
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
      const hex = state.hexes.get('0,0');
      const capabilities = getEntityCapabilities(hex!.entityId!, state);

      // tools is an array of {name, toolType, entityId, distance, isExplicitLink} objects
      expect(capabilities.tools).toHaveLength(2);
      expect(capabilities.tools.map(t => t.toolType)).toContain('filesystem');
      expect(capabilities.tools.map(t => t.toolType)).toContain('shell');
    });
  });
});

