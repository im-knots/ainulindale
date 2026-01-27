/**
 * Error Types - Typed error classes for better error handling
 *
 * These replace string errors throughout the engine for improved
 * type safety and error categorization.
 */

/**
 * Base error class for all engine errors
 */
export class EngineError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
    // Maintains proper stack trace in V8 (type assertion for non-standard property)
    const ErrorWithCapture = Error as typeof Error & {
      captureStackTrace?: (target: object, constructor: Function) => void;
    };
    if (ErrorWithCapture.captureStackTrace) {
      ErrorWithCapture.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Tool execution errors
 */
export class ToolError extends EngineError {
  readonly toolName: string;

  constructor(message: string, toolName: string, code: ToolErrorCode, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'ToolError';
    this.toolName = toolName;
  }
}

export type ToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'TOOL_EXECUTION_FAILED'
  | 'TOOL_TIMEOUT'
  | 'TOOL_PERMISSION_DENIED'
  | 'TOOL_INVALID_PARAMS'
  | 'TOOL_NOT_AVAILABLE';

/**
 * LLM-related errors
 */
export class LLMError extends EngineError {
  readonly provider: string;
  readonly model?: string;

  constructor(message: string, provider: string, code: LLMErrorCode, model?: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'LLMError';
    this.provider = provider;
    this.model = model;
  }
}

export type LLMErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'API_KEY_MISSING'
  | 'API_REQUEST_FAILED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'CONTENT_FILTER_TRIGGERED';

/**
 * Board/workflow errors
 */
export class BoardError extends EngineError {
  readonly boardId?: string;

  constructor(message: string, code: BoardErrorCode, boardId?: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'BoardError';
    this.boardId = boardId;
  }
}

export type BoardErrorCode =
  | 'BOARD_NOT_FOUND'
  | 'BOARD_ALREADY_RUNNING'
  | 'BOARD_NOT_RUNNING'
  | 'INVALID_HEX_POSITION'
  | 'ENTITY_NOT_FOUND'
  | 'INVALID_CONNECTION';

/**
 * RBAC/permission errors
 */
export class PermissionError extends EngineError {
  readonly entityId: string;
  readonly resourceId?: string;
  readonly action?: string;

  constructor(
    message: string,
    entityId: string,
    code: PermissionErrorCode,
    resourceId?: string,
    action?: string,
    details?: Record<string, unknown>
  ) {
    super(message, code, details);
    this.name = 'PermissionError';
    this.entityId = entityId;
    this.resourceId = resourceId;
    this.action = action;
  }
}

export type PermissionErrorCode =
  | 'ACCESS_DENIED'
  | 'NOT_IN_RANGE'
  | 'ZONE_RESTRICTED'
  | 'LINKING_REQUIRED';

/**
 * Type guard functions
 */
export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}

export function isLLMError(error: unknown): error is LLMError {
  return error instanceof LLMError;
}

export function isBoardError(error: unknown): error is BoardError {
  return error instanceof BoardError;
}

export function isPermissionError(error: unknown): error is PermissionError {
  return error instanceof PermissionError;
}

export function isEngineError(error: unknown): error is EngineError {
  return error instanceof EngineError;
}

/**
 * Helper to convert unknown error to EngineError
 */
export function toEngineError(error: unknown, defaultCode = 'UNKNOWN_ERROR'): EngineError {
  if (isEngineError(error)) return error;
  if (error instanceof Error) {
    return new EngineError(error.message, defaultCode, { originalError: error.name });
  }
  return new EngineError(String(error), defaultCode);
}

