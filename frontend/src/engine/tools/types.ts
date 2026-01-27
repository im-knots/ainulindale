/**
 * Tool Provider Types - defines the interface for tool implementations
 *
 * Uses Zod schemas for parameter validation.
 * The Vercel AI SDK handles JSON Schema conversion internally.
 */

import { z } from 'zod';

// JSON Schema type (subset used for display purposes)
export interface JSONSchema7 {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JSONSchema7>;
  required?: string[];
  items?: JSONSchema7;
  enum?: unknown[];
  default?: unknown;
  additionalProperties?: boolean | JSONSchema7;
}

// Tool definition with JSON Schema parameters (for display/backwards compat)
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema7;
}

// Tool definition with Zod schema (used by AI SDK)
export interface ZodToolDefinition {
  name: string;
  description: string;
  // Zod schema for parameter validation - AI SDK handles conversion
  schema: z.ZodType;
  // Execute function
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

// Tool execution result
export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration?: number; // ms
  // Truncation metadata (set when output was truncated)
  truncated?: boolean;
  originalLength?: number;
}

// Tool provider interface - implemented by each tool type
export interface ToolProvider {
  name: string;
  description: string;

  // List available tools with JSON Schema (for display)
  getTools(): ToolDefinition[];

  // Get Zod-based tool definitions (for AI SDK integration)
  getZodTools?(): ZodToolDefinition[];

  // Execute a tool
  execute(toolName: string, params: Record<string, unknown>): Promise<ToolResult>;

  // Check if provider is available
  isAvailable(): boolean;
}

// Tool registry - maps server types to providers
export interface ToolRegistry {
  register(serverType: string, provider: ToolProvider): void;
  get(serverType: string): ToolProvider | undefined;
  getAll(): Map<string, ToolProvider>;
}

/**
 * Simple helper to convert Zod schema to JSON Schema for display purposes.
 * The AI SDK's zodSchema() handles full conversion internally for LLM calls.
 * This is just for UI display and backwards compatibility.
 */
export function zodToJsonSchema(schema: z.ZodType): JSONSchema7 {
  // Try to use Zod v4's toJSONSchema method if available on the schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemaAny = schema as any;
  if (typeof schemaAny.toJSONSchema === 'function') {
    try {
      return schemaAny.toJSONSchema() as JSONSchema7;
    } catch {
      // Fall through to basic fallback
    }
  }

  // Basic fallback - just return a generic object schema
  // The actual schema conversion is handled by the AI SDK's zodSchema()
  return { type: 'object', properties: {} };
}

