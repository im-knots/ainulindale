/**
 * Tests for output-truncation.ts
 */

import { describe, it, expect } from 'vitest';
import {
  truncateOutput,
  truncateToolResult,
  DEFAULT_TRUNCATION_CONFIG,
  createFileReference,
  getFileReferenceContent,
  clearFileReference,
  processLargeOutput,
  FILE_REFERENCE_THRESHOLD,
  FileReference,
} from './output-truncation';

describe('output-truncation', () => {
  describe('truncateOutput', () => {
    it('does not truncate output within limits', () => {
      const content = 'Hello, world!';
      const result = truncateOutput(content, 'filesystem');

      expect(result.wasTruncated).toBe(false);
      expect(result.content).toBe(content);
      expect(result.originalLength).toBe(content.length);
    });

    it('truncates output exceeding character limit', () => {
      const content = 'x'.repeat(60000); // Exceeds 50KB filesystem limit
      const result = truncateOutput(content, 'filesystem');

      expect(result.wasTruncated).toBe(true);
      expect(result.originalLength).toBe(60000);
      expect(result.truncatedLength).toBeLessThan(60000);
      expect(result.remainingCharacters).toBe(10000);
    });

    it('truncates output exceeding line limit', () => {
      const lines = Array(1500).fill('line').join('\n'); // Exceeds 1000 line limit
      const result = truncateOutput(lines, 'filesystem');

      expect(result.wasTruncated).toBe(true);
      // Should have exactly 1000 lines plus truncation message
      const outputLines = result.content.split('\n');
      expect(outputLines.length).toBe(1001); // 1000 lines + 1 truncation message
    });

    it('uses tool-specific config', () => {
      const content = 'x'.repeat(25000); // Exceeds 20KB shell limit but not filesystem
      
      const shellResult = truncateOutput(content, 'shell');
      const fsResult = truncateOutput(content, 'filesystem');

      expect(shellResult.wasTruncated).toBe(true);
      expect(fsResult.wasTruncated).toBe(false);
    });

    it('uses custom config when provided', () => {
      const content = 'x'.repeat(1000);
      const result = truncateOutput(content, 'filesystem', { maxOutputLength: 500 });

      expect(result.wasTruncated).toBe(true);
      expect(result.remainingCharacters).toBe(500);
    });

    it('includes truncation message with remaining chars', () => {
      const content = 'x'.repeat(100);
      const result = truncateOutput(content, 'filesystem', {
        maxOutputLength: 50,
        truncationMessage: '... [{remaining} chars truncated]',
      });

      expect(result.content).toContain('50 chars truncated');
    });
  });

  describe('truncateToolResult', () => {
    it('handles string results', () => {
      const result = 'x'.repeat(60000);
      const { result: truncated, truncationInfo } = truncateToolResult(result, 'filesystem');

      expect(typeof truncated).toBe('string');
      expect((truncated as string).length).toBeLessThan(60000);
      expect(truncationInfo).toBeDefined();
      expect(truncationInfo?.wasTruncated).toBe(true);
    });

    it('handles object results with string properties', () => {
      const result = {
        stdout: 'x'.repeat(25000),
        stderr: 'short error',
        exitCode: 0,
      };
      const { result: truncated, truncationInfo } = truncateToolResult(result, 'shell');

      expect(typeof truncated).toBe('object');
      const obj = truncated as Record<string, unknown>;
      expect((obj.stdout as string).length).toBeLessThan(25000);
      expect(obj.stderr).toBe('short error');
      expect(obj.exitCode).toBe(0);
      expect(truncationInfo).toBeDefined();
    });

    it('passes through non-string results unchanged', () => {
      const result = { count: 42, items: [1, 2, 3] };
      const { result: truncated, truncationInfo } = truncateToolResult(result, 'filesystem');

      expect(truncated).toEqual(result);
      expect(truncationInfo).toBeUndefined();
    });

    it('returns undefined truncationInfo when no truncation needed', () => {
      const result = 'short string';
      const { truncationInfo } = truncateToolResult(result, 'filesystem');

      expect(truncationInfo).toBeUndefined();
    });
  });

  describe('DEFAULT_TRUNCATION_CONFIG', () => {
    it('has config for filesystem', () => {
      expect(DEFAULT_TRUNCATION_CONFIG.filesystem).toBeDefined();
      expect(DEFAULT_TRUNCATION_CONFIG.filesystem.maxOutputLength).toBe(50000);
    });

    it('has config for shell', () => {
      expect(DEFAULT_TRUNCATION_CONFIG.shell).toBeDefined();
      expect(DEFAULT_TRUNCATION_CONFIG.shell.maxOutputLength).toBe(20000);
    });

    it('has default config', () => {
      expect(DEFAULT_TRUNCATION_CONFIG.default).toBeDefined();
      expect(DEFAULT_TRUNCATION_CONFIG.default.maxOutputLength).toBe(30000);
    });
  });

  describe('file reference system', () => {
    describe('createFileReference', () => {
      it('creates a file reference with correct metadata', () => {
        const content = 'x'.repeat(1000);
        const ref = createFileReference(content, 'filesystem');

        expect(ref.type).toBe('file_reference');
        expect(ref.path).toMatch(/^ainu:\/\/outputs\/output_/);
        expect(ref.size).toBe(1000);
        expect(ref.contentType).toBe('text/plain');
        expect(ref.preview).toBeDefined();
      });

      it('creates preview with first 10 lines', () => {
        const lines = Array(20).fill('line').map((l, i) => `${l} ${i + 1}`);
        const content = lines.join('\n');
        const ref = createFileReference(content, 'shell');

        expect(ref.previewLines).toBe(10);
        expect(ref.preview).toContain('line 1');
        expect(ref.preview).toContain('line 10');
        expect(ref.preview).toContain('...');
      });

      it('uses correct content type for shell', () => {
        const ref = createFileReference('test', 'shell');
        expect(ref.contentType).toBe('text/x-terminal');
      });
    });

    describe('getFileReferenceContent', () => {
      it('retrieves stored content', () => {
        const content = 'This is test content';
        const ref = createFileReference(content, 'filesystem');
        const retrieved = getFileReferenceContent(ref);

        expect(retrieved).toBe(content);
      });

      it('returns null for unknown references', () => {
        const fakeRef: FileReference = {
          type: 'file_reference',
          path: 'ainu://outputs/nonexistent',
          size: 100,
          contentType: 'text/plain',
          preview: 'test',
          previewLines: 1,
        };
        const retrieved = getFileReferenceContent(fakeRef);

        expect(retrieved).toBeNull();
      });
    });

    describe('clearFileReference', () => {
      it('removes stored content', () => {
        const content = 'Content to be cleared';
        const ref = createFileReference(content, 'filesystem');

        expect(getFileReferenceContent(ref)).toBe(content);

        clearFileReference(ref);

        expect(getFileReferenceContent(ref)).toBeNull();
      });
    });

    describe('processLargeOutput', () => {
      it('returns file reference for very large string output', () => {
        const content = 'x'.repeat(FILE_REFERENCE_THRESHOLD + 1000);
        const { result, fileReference } = processLargeOutput(content, 'filesystem');

        expect(fileReference).toBeDefined();
        expect((result as Record<string, unknown>).type).toBe('file_reference');
        expect((result as Record<string, unknown>).path).toBeDefined();
      });

      it('uses normal truncation for moderately large output', () => {
        const content = 'x'.repeat(60000); // Less than FILE_REFERENCE_THRESHOLD
        const { result, fileReference, truncationInfo } = processLargeOutput(content, 'filesystem');

        expect(fileReference).toBeUndefined();
        expect(truncationInfo).toBeDefined();
        expect(typeof result).toBe('string');
      });

      it('handles object with large string property', () => {
        const result = {
          stdout: 'x'.repeat(FILE_REFERENCE_THRESHOLD + 1000),
          exitCode: 0,
        };
        const { result: processed, fileReference } = processLargeOutput(result, 'shell');

        expect(fileReference).toBeDefined();
        expect((processed as Record<string, unknown>).exitCode).toBe(0);
        const stdout = (processed as Record<string, unknown>).stdout as Record<string, unknown>;
        expect(stdout.type).toBe('file_reference');
      });

      it('allows custom threshold', () => {
        const content = 'x'.repeat(5000);
        const { fileReference } = processLargeOutput(content, 'filesystem', {
          fileReferenceThreshold: 1000,
        });

        expect(fileReference).toBeDefined();
      });
    });
  });
});

