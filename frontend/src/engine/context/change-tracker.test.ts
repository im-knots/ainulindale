import { describe, it, expect, beforeEach } from 'vitest';
import { changeTracker } from './change-tracker';
import { EventBus } from '../event-bus';

describe('ChangeTracker', () => {
  beforeEach(() => {
    changeTracker.clearAll();
  });

  describe('addChange', () => {
    it('records a file change', () => {
      changeTracker.addChange({
        agentId: 'agent-1',
        agentName: 'Coder Agent',
        agentTemplate: 'coder',
        filePath: '/path/to/file.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-1',
      });

      const changes = changeTracker.getRecentChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0].filePath).toBe('/path/to/file.ts');
      expect(changes[0].agentId).toBe('agent-1');
    });
  });

  describe('getRecentChanges', () => {
    it('excludes changes from the requesting agent', () => {
      changeTracker.addChange({
        agentId: 'agent-1',
        agentName: 'Agent 1',
        agentTemplate: 'coder',
        filePath: '/file1.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-1',
      });
      changeTracker.addChange({
        agentId: 'agent-2',
        agentName: 'Agent 2',
        agentTemplate: 'coder',
        filePath: '/file2.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-1',
      });

      const changes = changeTracker.getRecentChanges('agent-1');
      expect(changes).toHaveLength(1);
      expect(changes[0].agentId).toBe('agent-2');
    });

    it('filters by accessible filesystem hex IDs', () => {
      changeTracker.addChange({
        agentId: 'agent-1',
        agentName: 'Agent 1',
        agentTemplate: 'coder',
        filePath: '/file1.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-1',
      });
      changeTracker.addChange({
        agentId: 'agent-2',
        agentName: 'Agent 2',
        agentTemplate: 'coder',
        filePath: '/file2.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-2',
      });

      // Only pass fs-hex-1 as accessible
      const changes = changeTracker.getRecentChanges(undefined, ['fs-hex-1']);
      expect(changes).toHaveLength(1);
      expect(changes[0].filesystemHexId).toBe('fs-hex-1');
    });

    it('returns all changes when no filters applied', () => {
      changeTracker.addChange({
        agentId: 'agent-1',
        agentName: 'Agent 1',
        agentTemplate: 'coder',
        filePath: '/file1.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-1',
      });
      changeTracker.addChange({
        agentId: 'agent-2',
        agentName: 'Agent 2',
        agentTemplate: 'coder',
        filePath: '/file2.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-2',
      });

      const changes = changeTracker.getRecentChanges();
      expect(changes).toHaveLength(2);
    });

    it('combines agent exclusion and filesystem filtering', () => {
      changeTracker.addChange({
        agentId: 'agent-1',
        agentName: 'Agent 1',
        agentTemplate: 'coder',
        filePath: '/file1.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-1',
      });
      changeTracker.addChange({
        agentId: 'agent-2',
        agentName: 'Agent 2',
        agentTemplate: 'coder',
        filePath: '/file2.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-1',
      });
      changeTracker.addChange({
        agentId: 'agent-2',
        agentName: 'Agent 2',
        agentTemplate: 'coder',
        filePath: '/file3.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-2', // Different filesystem
      });

      // Exclude agent-1, only fs-hex-1
      const changes = changeTracker.getRecentChanges('agent-1', ['fs-hex-1']);
      expect(changes).toHaveLength(1);
      expect(changes[0].filePath).toBe('/file2.ts');
    });
  });

  describe('formatForPrompt', () => {
    it('returns null when no changes', () => {
      const prompt = changeTracker.formatForPrompt();
      expect(prompt).toBeNull();
    });

    it('formats changes for prompt', () => {
      changeTracker.addChange({
        agentId: 'agent-1',
        agentName: 'Coder Agent',
        agentTemplate: 'coder',
        filePath: '/src/utils.ts',
        operation: 'write',
        filesystemHexId: 'fs-hex-1',
      });

      const prompt = changeTracker.formatForPrompt();
      expect(prompt).not.toBeNull();
      expect(prompt).toContain('Recent Filesystem Changes');
      expect(prompt).toContain('/src/utils.ts');
      expect(prompt).toContain('coder');
    });
  });
});

