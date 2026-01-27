/**
 * LLM types and interfaces
 */

// Tool call information for assistant messages
export interface LLMToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// Tool result for tool messages
export interface LLMToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
}

// Base message interface
interface LLMMessageBase {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

// System message
export interface LLMSystemMessage extends LLMMessageBase {
  role: 'system';
}

// User message
export interface LLMUserMessage extends LLMMessageBase {
  role: 'user';
}

// Assistant message (can include tool calls)
export interface LLMAssistantMessage extends LLMMessageBase {
  role: 'assistant';
  toolCalls?: LLMToolCall[];
}

// Tool result message
export interface LLMToolMessage {
  role: 'tool';
  content: string;
  toolCallId: string;
  toolName: string;
}

// Union type for all message types
export type LLMMessage = LLMSystemMessage | LLMUserMessage | LLMAssistantMessage | LLMToolMessage;

export interface LLMRequest {
  messages: LLMMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

export interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: {
    inputCost: number;     // $ for input tokens
    outputCost: number;    // $ for output tokens
    totalCost: number;     // Total $ cost
  };
  model: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  inputPrice: number;   // $ per 1M tokens
  outputPrice: number;  // $ per 1M tokens
  contextWindow?: number;
}

export type LLMProviderType =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'gemini'
  | 'cohere'
  | 'mistral'
  | 'ollama'
  | 'grok'
  | 'mock';


