/**
 * LLM module exports
 *
 * Uses Vercel AI SDK for all LLM interactions.
 * Individual provider implementations are no longer needed.
 */

export { llmClient, LLMClient } from './client';
export type { ToolCallResult, LLMResponseWithTools } from './client';
export type { LLMMessage, LLMRequest, LLMResponse, LLMProviderType, ModelInfo } from './types';

