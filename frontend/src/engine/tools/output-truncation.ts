/**
 * Tool Output Truncation - Handles large tool outputs
 *
 * Truncates outputs that exceed configurable limits to prevent
 * context window overflow and improve LLM performance.
 */

/**
 * Configuration for output truncation per tool type
 */
export interface TruncationConfig {
  maxOutputLength: number;       // Max characters for the output
  maxLineCount?: number;         // Max lines (for text output)
  truncationMessage?: string;    // Message to show when truncated
}

/**
 * Default truncation limits per tool type
 */
export const DEFAULT_TRUNCATION_CONFIG: Record<string, TruncationConfig> = {
  filesystem: {
    maxOutputLength: 50000,      // 50KB for file contents
    maxLineCount: 1000,          // Max 1000 lines
    truncationMessage: '... [output truncated, {remaining} more characters]',
  },
  shell: {
    maxOutputLength: 20000,      // 20KB for shell output
    maxLineCount: 500,           // Max 500 lines
    truncationMessage: '... [output truncated, {remaining} more characters]',
  },
  tasklist: {
    maxOutputLength: 10000,      // 10KB for tasklist
    maxLineCount: 200,
    truncationMessage: '... [truncated]',
  },
  default: {
    maxOutputLength: 30000,      // 30KB default
    maxLineCount: 750,
    truncationMessage: '... [output truncated, {remaining} more characters]',
  },
};

/**
 * Result of truncation operation
 */
export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  originalLength: number;
  truncatedLength: number;
  remainingCharacters?: number;
  remainingLines?: number;
}

/**
 * Truncate a string output based on configuration
 *
 * @param content - The content to truncate
 * @param toolType - Tool type for config lookup
 * @param customConfig - Optional custom config to override defaults
 * @returns Truncated content with metadata
 */
export function truncateOutput(
  content: string,
  toolType: string,
  customConfig?: Partial<TruncationConfig>
): TruncationResult {
  const config = {
    ...DEFAULT_TRUNCATION_CONFIG.default,
    ...DEFAULT_TRUNCATION_CONFIG[toolType],
    ...customConfig,
  };

  const originalLength = content.length;
  let truncated = content;
  let wasTruncated = false;
  let remainingChars: number | undefined;
  let remainingLines: number | undefined;

  // Check character limit
  if (truncated.length > config.maxOutputLength) {
    remainingChars = truncated.length - config.maxOutputLength;
    truncated = truncated.substring(0, config.maxOutputLength);
    wasTruncated = true;
  }

  // Check line limit if configured
  if (config.maxLineCount) {
    const lines = truncated.split('\n');
    if (lines.length > config.maxLineCount) {
      remainingLines = lines.length - config.maxLineCount;
      truncated = lines.slice(0, config.maxLineCount).join('\n');
      wasTruncated = true;
      // Recalculate remaining chars after line truncation
      if (truncated.length < originalLength) {
        remainingChars = originalLength - truncated.length;
      }
    }
  }

  // Add truncation message if truncated
  if (wasTruncated && config.truncationMessage) {
    const message = config.truncationMessage
      .replace('{remaining}', String(remainingChars || 0))
      .replace('{lines}', String(remainingLines || 0));
    truncated = truncated + '\n' + message;
  }

  return {
    content: truncated,
    wasTruncated,
    originalLength,
    truncatedLength: truncated.length,
    remainingCharacters: remainingChars,
    remainingLines,
  };
}

/**
 * Truncate a tool result, handling both string and object results
 *
 * @param result - The tool result to truncate
 * @param toolType - Tool type for config lookup
 * @param customConfig - Optional custom config
 * @returns Truncated result
 */
export function truncateToolResult(
  result: unknown,
  toolType: string,
  customConfig?: Partial<TruncationConfig>
): { result: unknown; truncationInfo?: TruncationResult } {
  // Handle string results directly
  if (typeof result === 'string') {
    const truncationInfo = truncateOutput(result, toolType, customConfig);
    return {
      result: truncationInfo.content,
      truncationInfo: truncationInfo.wasTruncated ? truncationInfo : undefined,
    };
  }

  // Handle object results - truncate string properties
  if (result && typeof result === 'object') {
    const truncated: Record<string, unknown> = {};
    let anyTruncated = false;
    let truncationInfo: TruncationResult | undefined;

    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const info = truncateOutput(value, toolType, customConfig);
        truncated[key] = info.content;
        if (info.wasTruncated) {
          anyTruncated = true;
          truncationInfo = info; // Keep last truncation info
        }
      } else {
        truncated[key] = value;
      }
    }

    return {
      result: truncated,
      truncationInfo: anyTruncated ? truncationInfo : undefined,
    };
  }

  // Non-string, non-object results pass through
  return { result };
}

/**
 * File reference for very large outputs
 */
export interface FileReference {
  type: 'file_reference';
  path: string;
  size: number;
  contentType: string;
  preview: string;        // First N characters for context
  previewLines: number;   // Number of lines in preview
}

/**
 * Threshold for converting to file reference (in characters)
 * When output exceeds this, save to file instead of inline truncation
 */
export const FILE_REFERENCE_THRESHOLD = 100000; // 100KB

/**
 * In-memory storage for large outputs (browser environment)
 * In production, this would use localStorage or IndexedDB
 */
const largeOutputStore = new Map<string, string>();

/**
 * Generate a unique ID for file references
 */
function generateFileId(): string {
  return `output_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Store large output and return a file reference
 *
 * @param content - The large content to store
 * @param toolType - Tool type for metadata
 * @returns File reference object
 */
export function createFileReference(content: string, toolType: string): FileReference {
  const fileId = generateFileId();
  const path = `ainu://outputs/${fileId}`;

  // Store the content
  largeOutputStore.set(fileId, content);

  // Create preview (first 500 chars or 10 lines)
  const lines = content.split('\n');
  const previewLines = Math.min(lines.length, 10);
  const preview = lines.slice(0, previewLines).join('\n').substring(0, 500);

  return {
    type: 'file_reference',
    path,
    size: content.length,
    contentType: getContentType(toolType),
    preview: preview + (content.length > preview.length ? '\n...' : ''),
    previewLines,
  };
}

/**
 * Retrieve content from a file reference
 *
 * @param reference - The file reference
 * @returns The stored content, or null if not found
 */
export function getFileReferenceContent(reference: FileReference): string | null {
  const fileId = reference.path.replace('ainu://outputs/', '');
  return largeOutputStore.get(fileId) ?? null;
}

/**
 * Clear a file reference from storage
 */
export function clearFileReference(reference: FileReference): void {
  const fileId = reference.path.replace('ainu://outputs/', '');
  largeOutputStore.delete(fileId);
}

/**
 * Get content type based on tool type
 */
function getContentType(toolType: string): string {
  switch (toolType) {
    case 'filesystem':
      return 'text/plain';
    case 'shell':
      return 'text/x-terminal';
    default:
      return 'text/plain';
  }
}

/**
 * Process tool result with file reference support for very large outputs
 *
 * @param result - The tool result
 * @param toolType - Tool type
 * @param options - Processing options
 * @returns Processed result (possibly with file reference)
 */
export function processLargeOutput(
  result: unknown,
  toolType: string,
  options: {
    fileReferenceThreshold?: number;
    truncationConfig?: Partial<TruncationConfig>;
  } = {}
): {
  result: unknown;
  fileReference?: FileReference;
  truncationInfo?: TruncationResult;
} {
  const threshold = options.fileReferenceThreshold ?? FILE_REFERENCE_THRESHOLD;

  // Handle string results
  if (typeof result === 'string') {
    // Check if we need a file reference
    if (result.length > threshold) {
      const fileReference = createFileReference(result, toolType);
      return {
        result: {
          type: 'file_reference',
          message: `Output too large (${result.length} chars). Saved to file reference.`,
          preview: fileReference.preview,
          path: fileReference.path,
          size: fileReference.size,
        },
        fileReference,
      };
    }

    // Otherwise use normal truncation
    return truncateToolResult(result, toolType, options.truncationConfig);
  }

  // Handle object results - check string properties
  if (result && typeof result === 'object') {
    const processed: Record<string, unknown> = {};
    let fileReference: FileReference | undefined;
    let truncationInfo: TruncationResult | undefined;

    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > threshold) {
        // This property needs a file reference
        fileReference = createFileReference(value, toolType);
        processed[key] = {
          type: 'file_reference',
          message: `Output too large (${value.length} chars). Saved to file reference.`,
          preview: fileReference.preview,
          path: fileReference.path,
        };
      } else if (typeof value === 'string') {
        const info = truncateOutput(value, toolType, options.truncationConfig);
        processed[key] = info.content;
        if (info.wasTruncated) {
          truncationInfo = info;
        }
      } else {
        processed[key] = value;
      }
    }

    return { result: processed, fileReference, truncationInfo };
  }

  return { result };
}

