import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  filesystemContextManager,
  FileReadRecord,
  StalenessResult,
} from './filesystem-context-manager';
import { EventBus } from '../event-bus';

describe('FilesystemContextManager', () => {
  beforeEach(() => {
    // Clear all state before each test
    filesystemContextManager.clearAll();
  });

  describe('recordRead', () => {
    it('records a file read for an agent on a filesystem hex', () => {
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', 1000);
      
      expect(filesystemContextManager.hasRead('agent-1', 'fs-hex-1', '/path/to/file.ts')).toBe(true);
    });

    it('tracks reads per filesystem hex independently', () => {
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', 1000);
      
      // Same agent, same file, but different filesystem hex
      expect(filesystemContextManager.hasRead('agent-1', 'fs-hex-2', '/path/to/file.ts')).toBe(false);
    });

    it('tracks reads per agent independently', () => {
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', 1000);
      
      // Different agent, same filesystem hex and file
      expect(filesystemContextManager.hasRead('agent-2', 'fs-hex-1', '/path/to/file.ts')).toBe(false);
    });
  });

  describe('getReadRecord', () => {
    it('returns the read record with correct details', () => {
      const mtime = Date.now();
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', mtime);
      
      const record = filesystemContextManager.getReadRecord('agent-1', 'fs-hex-1', '/path/to/file.ts');
      
      expect(record).not.toBeNull();
      expect(record?.agentId).toBe('agent-1');
      expect(record?.filesystemHexId).toBe('fs-hex-1');
      expect(record?.filePath).toBe('/path/to/file.ts');
      expect(record?.readMtime).toBe(mtime);
    });

    it('returns null for non-existent reads', () => {
      const record = filesystemContextManager.getReadRecord('agent-1', 'fs-hex-1', '/nonexistent.ts');
      expect(record).toBeNull();
    });
  });

  describe('checkReadBeforeWrite', () => {
    it('allows write when file has been read first', () => {
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', 1000);
      
      const result = filesystemContextManager.checkReadBeforeWrite('agent-1', 'fs-hex-1', '/path/to/file.ts');
      
      expect(result.allowed).toBe(true);
      expect(result.filePath).toBe('/path/to/file.ts');
      expect(result.filesystemHexId).toBe('fs-hex-1');
    });

    it('denies write when file has not been read', () => {
      const result = filesystemContextManager.checkReadBeforeWrite('agent-1', 'fs-hex-1', '/path/to/file.ts');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('must read');
      expect(result.reason).toContain('/path/to/file.ts');
    });

    it('denies write when file was read from different filesystem hex', () => {
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', 1000);

      // Try to write on a different filesystem hex
      const result = filesystemContextManager.checkReadBeforeWrite('agent-1', 'fs-hex-2', '/path/to/file.ts');

      expect(result.allowed).toBe(false);
    });

    it('allows write to new file that does not exist (fileExists=false)', () => {
      // No prior read, but file doesn't exist - should be allowed
      const result = filesystemContextManager.checkReadBeforeWrite(
        'agent-1',
        'fs-hex-1',
        '/path/to/new-file.ts',
        false  // fileExists = false
      );

      expect(result.allowed).toBe(true);
      expect(result.filePath).toBe('/path/to/new-file.ts');
      expect(result.reason).toBeUndefined();
    });

    it('denies write to existing file without prior read (fileExists=true, default)', () => {
      // No prior read, file exists (default) - should be denied
      const result = filesystemContextManager.checkReadBeforeWrite(
        'agent-1',
        'fs-hex-1',
        '/path/to/existing-file.ts',
        true  // fileExists = true (default)
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('must read');
    });

    it('uses default fileExists=true when not specified', () => {
      // No prior read, fileExists not specified (defaults to true) - should be denied
      const result = filesystemContextManager.checkReadBeforeWrite(
        'agent-1',
        'fs-hex-1',
        '/path/to/file.ts'
        // fileExists not specified
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe('staleness detection', () => {
    it('detects stale files when another agent modifies after read', async () => {
      const eventBus = new EventBus();
      filesystemContextManager.subscribe(eventBus);
      
      // Agent 1 reads a file
      const readTime = Date.now();
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', readTime);
      
      // Wait a bit then Agent 2 modifies the file (via event)
      await new Promise(r => setTimeout(r, 10));
      eventBus.emit({
        type: 'filesystem.changed',
        hexId: 'fs-hex-1',
        boardId: 'board-1',
        data: {
          path: '/path/to/file.ts',
          operation: 'write',
          changedBy: 'agent-2',
          changedByName: 'Agent 2',
        },
        timestamp: new Date(),
      });
      
      // Check staleness for agent 1
      const staleness = filesystemContextManager.checkStaleness('agent-1', 'fs-hex-1', '/path/to/file.ts');
      
      expect(staleness).not.toBeNull();
      expect(staleness?.isStale).toBe(true);
      expect(staleness?.modifiedBy).toBe('agent-2');
      expect(staleness?.modifiedByName).toBe('Agent 2');
      
      filesystemContextManager.unsubscribeAll();
    });

    it('does not mark own modifications as stale', async () => {
      const eventBus = new EventBus();
      filesystemContextManager.subscribe(eventBus);
      
      // Agent 1 reads a file
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', Date.now());
      
      // Wait a bit then same agent modifies the file
      await new Promise(r => setTimeout(r, 10));
      eventBus.emit({
        type: 'filesystem.changed',
        hexId: 'fs-hex-1',
        boardId: 'board-1',
        data: {
          path: '/path/to/file.ts',
          operation: 'write',
          changedBy: 'agent-1',
          changedByName: 'Agent 1',
        },
        timestamp: new Date(),
      });
      
      // Check staleness - should be null since it was own modification
      const staleness = filesystemContextManager.checkStaleness('agent-1', 'fs-hex-1', '/path/to/file.ts');
      expect(staleness).toBeNull();

      filesystemContextManager.unsubscribeAll();
    });

    it('returns all stale files via getStaleFiles', async () => {
      const eventBus = new EventBus();
      filesystemContextManager.subscribe(eventBus);

      // Agent 1 reads multiple files
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/file1.ts', Date.now());
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/file2.ts', Date.now());

      await new Promise(r => setTimeout(r, 10));

      // Agent 2 modifies one file
      eventBus.emit({
        type: 'filesystem.changed',
        hexId: 'fs-hex-1',
        boardId: 'board-1',
        data: {
          path: '/file1.ts',
          operation: 'write',
          changedBy: 'agent-2',
          changedByName: 'Agent 2',
        },
        timestamp: new Date(),
      });

      const staleFiles = filesystemContextManager.getStaleFiles('agent-1', 'fs-hex-1');
      expect(staleFiles).toHaveLength(1);
      expect(staleFiles[0].filePath).toBe('/file1.ts');

      filesystemContextManager.unsubscribeAll();
    });
  });

  describe('formatStaleFilesForPrompt', () => {
    it('returns formatted prompt with stale files', async () => {
      const eventBus = new EventBus();
      filesystemContextManager.subscribe(eventBus);

      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', Date.now());

      await new Promise(r => setTimeout(r, 10));

      eventBus.emit({
        type: 'filesystem.changed',
        hexId: 'fs-hex-1',
        boardId: 'board-1',
        data: {
          path: '/path/to/file.ts',
          operation: 'write',
          changedBy: 'agent-2',
          changedByName: 'Coder Agent',
        },
        timestamp: new Date(),
      });

      const prompt = filesystemContextManager.formatStaleFilesForPrompt('agent-1');

      expect(prompt).not.toBeNull();
      expect(prompt).toContain('Stale File Warning');
      expect(prompt).toContain('/path/to/file.ts');
      expect(prompt).toContain('Coder Agent');

      filesystemContextManager.unsubscribeAll();
    });

    it('returns null when no stale files', () => {
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/path/to/file.ts', Date.now());

      const prompt = filesystemContextManager.formatStaleFilesForPrompt('agent-1');
      expect(prompt).toBeNull();
    });
  });

  describe('clearAgentRecords', () => {
    it('clears only the specified agent records', () => {
      filesystemContextManager.recordRead('agent-1', 'fs-hex-1', '/file1.ts', 1000);
      filesystemContextManager.recordRead('agent-2', 'fs-hex-1', '/file2.ts', 1000);

      filesystemContextManager.clearAgentRecords('agent-1');

      expect(filesystemContextManager.hasRead('agent-1', 'fs-hex-1', '/file1.ts')).toBe(false);
      expect(filesystemContextManager.hasRead('agent-2', 'fs-hex-1', '/file2.ts')).toBe(true);
    });
  });
});

