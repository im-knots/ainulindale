/**
 * LLM Client - Unified interface using Vercel AI SDK
 *
 * This client uses the Vercel AI SDK for all LLM interactions,
 * providing native function calling support across all providers.
 */

import { generateText, streamText, tool, zodSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createCohere } from '@ai-sdk/cohere';
import { createXai } from '@ai-sdk/xai';

import { LLMProviderType, LLMRequest, LLMResponse, LLMMessage, LLMAssistantMessage, LLMToolMessage, ModelInfo } from './types';
import { ZodToolDefinition } from '../engine/tools/types';
import type { ModelMessage, AssistantModelMessage, ToolModelMessage } from 'ai';

// Tool call result from AI SDK
export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

// Raw response metadata from provider
export interface RawResponseInfo {
  responseId?: string;
  modelId?: string;
  timestamp?: Date;
  headers?: Record<string, string>;
  body?: unknown;
  requestBody?: string;
  providerMetadata?: Record<string, unknown>;
}

// Extended response with tool calls
export interface LLMResponseWithTools extends LLMResponse {
  toolCalls?: ToolCallResult[];
  finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error' | 'other' | 'unknown';
  rawResponse?: RawResponseInfo;
}

/**
 * Convert our LLMMessage format to AI SDK ModelMessage format.
 * This handles tool calls and tool results properly for multi-turn conversations.
 */
function convertToAISDKMessages(messages: LLMMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: msg.content });
    } else if (msg.role === 'user') {
      result.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as LLMAssistantMessage;
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        // Assistant message with tool calls
        const coreAssistant: AssistantModelMessage = {
          role: 'assistant',
          content: [
            // Include any text content
            ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
            // Include tool calls - AI SDK uses 'input' not 'args'
            ...assistantMsg.toolCalls.map(tc => ({
              type: 'tool-call' as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.args,  // AI SDK expects 'input' for tool call arguments
            })),
          ],
        };
        result.push(coreAssistant);
      } else {
        // Simple text-only assistant message
        result.push({ role: 'assistant', content: [{ type: 'text', text: msg.content }] });
      }
    } else if (msg.role === 'tool') {
      const toolMsg = msg as LLMToolMessage;
      const coreToolMsg: ToolModelMessage = {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: toolMsg.toolCallId,
            toolName: toolMsg.toolName,
            // AI SDK expects 'output' as { type: 'text', value: string } or { type: 'json', value: ... }
            output: { type: 'text', value: toolMsg.content },
          },
        ],
      };
      result.push(coreToolMsg);
    }
  }

  return result;
}

// Default models per provider
const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.0-flash',
  cohere: 'command-r',
  mistral: 'mistral-small-latest',
  ollama: 'llama3.2',
  grok: 'grok-2',
  mock: 'mock-model',
};

// DeepSeek hardcoded models (docs page down)
const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: 'deepseek-chat', name: 'DeepSeek Chat', inputPrice: 0.14, outputPrice: 0.28, contextWindow: 64000 },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', inputPrice: 0.55, outputPrice: 2.19, contextWindow: 64000 },
];

class LLMClient {
  private apiKeys: Map<LLMProviderType, string> = new Map();
  private activeProvider: LLMProviderType = 'mock';
  private ollamaBaseUrl = 'http://localhost:11434/v1';

  /**
   * Set the active LLM provider
   */
  setProvider(provider: LLMProviderType): void {
    this.activeProvider = provider;
  }

  /**
   * Get the current provider
   */
  getProvider(): LLMProviderType {
    return this.activeProvider;
  }

  /**
   * Configure an API key for a provider
   */
  setApiKey(provider: LLMProviderType, apiKey: string): void {
    if (apiKey && apiKey.length > 0) {
      this.apiKeys.set(provider, apiKey);
    } else {
      this.apiKeys.delete(provider);
    }
  }

  /**
   * Get API key for a provider
   */
  getApiKey(provider: LLMProviderType): string | undefined {
    return this.apiKeys.get(provider);
  }

  /**
   * Check if a specific provider is configured
   */
  isProviderConfigured(provider: LLMProviderType): boolean {
    if (provider === 'mock') return true;
    if (provider === 'ollama') return true; // Ollama doesn't require API key
    return this.apiKeys.has(provider) && (this.apiKeys.get(provider)?.length ?? 0) > 0;
  }

  /**
   * Check if the active provider is configured
   */
  isConfigured(): boolean {
    return this.isProviderConfigured(this.activeProvider);
  }

  /**
   * Get list of providers that have been configured with API keys
   */
  getConfiguredProviders(): LLMProviderType[] {
    const configured: LLMProviderType[] = ['mock', 'ollama']; // Always available
    for (const [provider] of this.apiKeys) {
      if (!configured.includes(provider)) {
        configured.push(provider);
      }
    }
    return configured;
  }

  /**
   * Get the first configured provider (excluding mock/ollama) with its default model.
   * Priority order: openai, anthropic, deepseek, gemini, cohere, mistral, grok
   * Falls back to mock if no real provider is configured.
   */
  getDefaultProviderAndModel(): { provider: LLMProviderType; model: string } {
    // Priority order for checking configured providers
    const priorityOrder: LLMProviderType[] = [
      'openai', 'anthropic', 'deepseek', 'gemini', 'cohere', 'mistral', 'grok'
    ];

    for (const provider of priorityOrder) {
      if (this.isProviderConfigured(provider)) {
        return {
          provider,
          model: DEFAULT_MODELS[provider],
        };
      }
    }

    // Fallback to mock if no provider is configured
    return { provider: 'mock', model: 'mock-model' };
  }

  /**
   * Get list of all available providers
   */
  getAvailableProviders(): LLMProviderType[] {
    return Object.keys(DEFAULT_MODELS) as LLMProviderType[];
  }

  // Cache for dynamically fetched models
  private dynamicModelCache: Map<LLMProviderType, { models: ModelInfo[]; timestamp: number }> = new Map();
  private MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get models for a specific provider
   * Fetches from API - throws error if provider is down
   */
  async getModelsForProvider(provider: LLMProviderType): Promise<ModelInfo[]> {
    // Mock always uses static list
    if (provider === 'mock') {
      return [{ id: 'mock-model', name: 'Mock Model', inputPrice: 0, outputPrice: 0, contextWindow: 128000 }];
    }

    // Check cache first
    const cached = this.dynamicModelCache.get(provider);
    if (cached && Date.now() - cached.timestamp < this.MODEL_CACHE_TTL) {
      return cached.models;
    }

    // Fetch from API - throw error if it fails (provider is down)
    const models = await this.fetchModelsFromAPI(provider);
    if (models.length === 0) {
      throw new Error(`No models available from ${provider}`);
    }
    this.dynamicModelCache.set(provider, { models, timestamp: Date.now() });
    return models;
  }

  /**
   * Fetch models from provider API
   */
  private async fetchModelsFromAPI(provider: LLMProviderType): Promise<ModelInfo[]> {
    const apiKey = this.apiKeys.get(provider);
    if (!apiKey && provider !== 'ollama' && provider !== 'deepseek') {
      throw new Error(`No API key configured for ${provider}`);
    }

    switch (provider) {
      case 'openai':
        return this.fetchOpenAIModels(apiKey!);
      case 'anthropic':
        return this.fetchAnthropicModels(apiKey!);
      case 'deepseek':
        // DeepSeek docs page down - use hardcoded list
        return DEEPSEEK_MODELS;
      case 'gemini':
        return this.fetchGeminiModels(apiKey!);
      case 'cohere':
        return this.fetchCohereModels(apiKey!);
      case 'mistral':
        return this.fetchMistralModels(apiKey!);
      case 'grok':
        return this.fetchGrokModels(apiKey!);
      case 'ollama':
        return this.fetchOllamaModels();
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Fetch models from OpenAI API
   */
  private async fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const models: ModelInfo[] = [];

    // Filter for chat models and map to ModelInfo
    for (const model of data.data) {
      const id = model.id as string;

      // Skip non-chat models (embeddings, audio, etc.)
      if (id.includes('embedding') || id.includes('whisper') || id.includes('tts') ||
          id.includes('dall-e') || id.includes('davinci') || id.includes('babbage') ||
          id.includes('curie') || id.includes('ada') || id.includes('moderation')) {
        continue;
      }

      // Estimate pricing based on model name patterns
      models.push({
        id,
        name: this.formatModelName(id),
        inputPrice: this.estimateOpenAIPrice(id, 'input'),
        outputPrice: this.estimateOpenAIPrice(id, 'output'),
        contextWindow: 128000,
      });
    }

    // Sort by name, with popular models first
    const popularOrder = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o1-preview', 'o3-mini'];
    models.sort((a, b) => {
      const aIdx = popularOrder.findIndex(p => a.id.startsWith(p));
      const bIdx = popularOrder.findIndex(p => b.id.startsWith(p));
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    return models;
  }

  /**
   * Estimate OpenAI pricing for models not in curated list
   */
  private estimateOpenAIPrice(modelId: string, type: 'input' | 'output'): number {
    // Estimates based on typical OpenAI pricing patterns
    if (modelId.includes('o1') || modelId.includes('o3')) {
      return type === 'input' ? 15.00 : 60.00;
    }
    if (modelId.includes('gpt-4o-mini')) {
      return type === 'input' ? 0.15 : 0.60;
    }
    if (modelId.includes('gpt-4o')) {
      return type === 'input' ? 2.50 : 10.00;
    }
    if (modelId.includes('gpt-4-turbo')) {
      return type === 'input' ? 10.00 : 30.00;
    }
    if (modelId.includes('gpt-4')) {
      return type === 'input' ? 30.00 : 60.00;
    }
    // Default to mini pricing
    return type === 'input' ? 0.15 : 0.60;
  }

  /**
   * Estimate Anthropic pricing based on model tier
   */
  private estimateAnthropicPrice(modelId: string): { input: number; output: number } {
    if (modelId.includes('opus')) {
      return { input: 15.00, output: 75.00 };
    }
    if (modelId.includes('sonnet')) {
      return { input: 3.00, output: 15.00 };
    }
    if (modelId.includes('haiku')) {
      return { input: 0.80, output: 4.00 };
    }
    // Default to sonnet pricing
    return { input: 3.00, output: 15.00 };
  }

  /**
   * Estimate Gemini pricing based on model tier
   */
  private estimateGeminiPrice(modelId: string): { input: number; output: number } {
    if (modelId.includes('pro')) {
      return { input: 1.25, output: 5.00 };
    }
    if (modelId.includes('flash')) {
      return { input: 0.10, output: 0.40 };
    }
    // Default to flash pricing
    return { input: 0.10, output: 0.40 };
  }

  /**
   * Estimate Cohere pricing based on model tier
   */
  private estimateCoherePrice(modelId: string): { input: number; output: number } {
    if (modelId.includes('command-r-plus')) {
      return { input: 2.50, output: 10.00 };
    }
    if (modelId.includes('command-r')) {
      return { input: 0.15, output: 0.60 };
    }
    // Default to command-r pricing
    return { input: 0.50, output: 1.50 };
  }

  /**
   * Estimate Grok pricing based on model tier
   */
  private estimateGrokPrice(modelId: string): { input: number; output: number } {
    if (modelId.includes('grok-4') && !modelId.includes('fast')) {
      return { input: 30.00, output: 150.00 };
    }
    if (modelId.includes('grok-3') && !modelId.includes('mini')) {
      return { input: 30.00, output: 150.00 };
    }
    if (modelId.includes('grok-3-mini')) {
      return { input: 3.00, output: 5.00 };
    }
    if (modelId.includes('grok-2')) {
      return { input: 20.00, output: 100.00 };
    }
    if (modelId.includes('fast')) {
      return { input: 2.00, output: 5.00 };
    }
    // Default to grok-2 pricing
    return { input: 20.00, output: 100.00 };
  }

  /**
   * Estimate Mistral pricing based on model tier
   */
  private estimateMistralPrice(modelId: string): { input: number; output: number } {
    if (modelId.includes('large')) {
      return { input: 2.00, output: 6.00 };
    }
    if (modelId.includes('codestral')) {
      return { input: 0.30, output: 0.90 };
    }
    if (modelId.includes('small')) {
      return { input: 0.20, output: 0.60 };
    }
    // Default to small pricing
    return { input: 0.50, output: 1.50 };
  }

  /**
   * Calculate cost based on token usage and model pricing
   * Uses pricing from the model cache (fetched from provider APIs)
   */
  private calculateCost(
    provider: LLMProviderType,
    modelId: string,
    promptTokens: number,
    completionTokens: number
  ): { inputCost: number; outputCost: number; totalCost: number } {
    // Try to get pricing from cached models
    const cached = this.dynamicModelCache.get(provider);
    if (cached) {
      const model = cached.models.find(m => m.id === modelId);
      if (model) {
        const inputCost = (promptTokens / 1_000_000) * model.inputPrice;
        const outputCost = (completionTokens / 1_000_000) * model.outputPrice;
        return {
          inputCost,
          outputCost,
          totalCost: inputCost + outputCost,
        };
      }
    }

    // Fallback: estimate pricing if model not in cache
    let pricing: { input: number; output: number };
    switch (provider) {
      case 'openai':
        pricing = { input: this.estimateOpenAIPrice(modelId, 'input'), output: this.estimateOpenAIPrice(modelId, 'output') };
        break;
      case 'anthropic':
        pricing = this.estimateAnthropicPrice(modelId);
        break;
      case 'deepseek':
        // Use DeepSeek hardcoded pricing
        const deepseekModel = DEEPSEEK_MODELS.find(m => m.id === modelId);
        pricing = deepseekModel ? { input: deepseekModel.inputPrice, output: deepseekModel.outputPrice } : { input: 0.14, output: 0.28 };
        break;
      case 'gemini':
        pricing = this.estimateGeminiPrice(modelId);
        break;
      case 'cohere':
        pricing = this.estimateCoherePrice(modelId);
        break;
      case 'mistral':
        pricing = this.estimateMistralPrice(modelId);
        break;
      case 'grok':
        pricing = this.estimateGrokPrice(modelId);
        break;
      case 'ollama':
      case 'mock':
        pricing = { input: 0, output: 0 };
        break;
      default:
        pricing = { input: 0, output: 0 };
    }

    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  /**
   * Fetch models from Anthropic API
   */
  private async fetchAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const models: ModelInfo[] = [];

    for (const model of data.data || []) {
      const id = model.id as string;

      // Only include chat models (claude-*)
      if (!id.startsWith('claude-')) {
        continue;
      }

      // Estimate pricing based on model tier
      const pricing = this.estimateAnthropicPrice(id);
      models.push({
        id,
        name: this.formatModelName(id),
        inputPrice: pricing.input,
        outputPrice: pricing.output,
        contextWindow: 200000,
      });
    }

    // Sort by name, with popular models first
    const popularOrder = ['claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus'];
    models.sort((a, b) => {
      const aIdx = popularOrder.findIndex(p => a.id.startsWith(p));
      const bIdx = popularOrder.findIndex(p => b.id.startsWith(p));
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    return models;
  }

  /**
   * Fetch models from Ollama local server
   */
  private async fetchOllamaModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl.replace('/v1', '')}/api/tags`);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const models: ModelInfo[] = [];

      for (const model of data.models || []) {
        models.push({
          id: model.name,
          name: this.formatModelName(model.name),
          inputPrice: 0,
          outputPrice: 0,
          contextWindow: 128000, // Default, varies by model
        });
      }

      return models;
    } catch (error) {
      // Ollama not running - throw error
      throw new Error(`Ollama is not running or not accessible: ${error}`);
    }
  }

  /**
   * Fetch models from Gemini API
   */
  private async fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const models: ModelInfo[] = [];

    for (const model of data.models || []) {
      const id = model.name.replace('models/', '');

      // Only include generative models (gemini-*)
      if (!id.startsWith('gemini-')) {
        continue;
      }

      // Estimate pricing based on model tier
      const pricing = this.estimateGeminiPrice(id);
      models.push({
        id,
        name: this.formatModelName(id),
        inputPrice: pricing.input,
        outputPrice: pricing.output,
        contextWindow: 1000000,
      });
    }

    // Sort by name, with popular models first
    const popularOrder = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    models.sort((a, b) => {
      const aIdx = popularOrder.findIndex(p => a.id.startsWith(p));
      const bIdx = popularOrder.findIndex(p => b.id.startsWith(p));
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    return models;
  }

  /**
   * Fetch models from Cohere API
   */
  private async fetchCohereModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch('https://api.cohere.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      }
    });

    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.status}`);
    }

    const data = await response.json();
    const models: ModelInfo[] = [];

    for (const model of data.models || []) {
      const id = model.name as string;

      // Only include command models (chat models)
      if (!id.startsWith('command')) {
        continue;
      }

      // Estimate pricing based on model tier
      const pricing = this.estimateCoherePrice(id);
      models.push({
        id,
        name: this.formatModelName(id),
        inputPrice: pricing.input,
        outputPrice: pricing.output,
        contextWindow: 128000,
      });
    }

    // Sort by name, with popular models first
    const popularOrder = ['command-r-plus', 'command-r'];
    models.sort((a, b) => {
      const aIdx = popularOrder.findIndex(p => a.id.startsWith(p));
      const bIdx = popularOrder.findIndex(p => b.id.startsWith(p));
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    return models;
  }

  /**
   * Fetch models from Grok (xAI) API
   */
  private async fetchGrokModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch('https://api.x.ai/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      }
    });

    if (!response.ok) {
      throw new Error(`Grok API error: ${response.status}`);
    }

    const data = await response.json();
    const models: ModelInfo[] = [];

    for (const model of data.data || []) {
      const id = model.id as string;

      // Estimate pricing based on model tier
      const pricing = this.estimateGrokPrice(id);
      models.push({
        id,
        name: this.formatModelName(id),
        inputPrice: pricing.input,
        outputPrice: pricing.output,
        contextWindow: 128000,
      });
    }

    // Sort by name
    models.sort((a, b) => a.name.localeCompare(b.name));

    return models;
  }

  /**
   * Fetch models from Mistral API
   */
  private async fetchMistralModels(apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch('https://api.mistral.ai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new Error(`Mistral API error: ${response.status}`);
    }

    const data = await response.json();
    const models: ModelInfo[] = [];

    for (const model of data.data || []) {
      const id = model.id as string;
      const pricing = this.estimateMistralPrice(id);

      models.push({
        id,
        name: this.formatModelName(id),
        inputPrice: pricing.input,
        outputPrice: pricing.output,
        contextWindow: 32000,
      });
    }

    return models;
  }

  /**
   * Format model ID into a readable name
   */
  private formatModelName(modelId: string): string {
    return modelId
      .replace(/-/g, ' ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/Gpt/g, 'GPT')
      .replace(/O1/g, 'o1')
      .replace(/O3/g, 'o3');
  }

  /**
   * Clear model cache (useful when API keys change)
   */
  clearModelCache(): void {
    this.dynamicModelCache.clear();
  }

  /**
   * Get list of available models for the active provider
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    return this.getModelsForProvider(this.activeProvider);
  }

  /**
   * Create an AI SDK model instance for the given provider and model
   */
  private createModel(provider: LLMProviderType, modelId: string) {
    const apiKey = this.apiKeys.get(provider);

    switch (provider) {
      case 'openai': {
        const openai = createOpenAI({ apiKey });
        return openai(modelId);
      }
      case 'anthropic': {
        const anthropic = createAnthropic({ apiKey });
        return anthropic(modelId);
      }
      case 'deepseek': {
        // DeepSeek uses OpenAI-compatible API
        const deepseek = createOpenAI({
          apiKey,
          baseURL: 'https://api.deepseek.com/v1',
        });
        return deepseek(modelId);
      }
      case 'gemini': {
        const google = createGoogleGenerativeAI({ apiKey });
        return google(modelId);
      }
      case 'cohere': {
        const cohere = createCohere({ apiKey });
        return cohere(modelId);
      }
      case 'mistral': {
        const mistral = createMistral({ apiKey });
        return mistral(modelId);
      }
      case 'ollama': {
        // Ollama uses OpenAI-compatible API
        const ollama = createOpenAI({
          apiKey: 'ollama', // Ollama doesn't need real key
          baseURL: this.ollamaBaseUrl,
        });
        return ollama(modelId);
      }
      case 'grok': {
        const xai = createXai({ apiKey });
        return xai(modelId);
      }
      case 'mock':
      default:
        throw new Error(`Cannot create model for provider: ${provider}`);
    }
  }

  /**
   * Complete a prompt using the active provider (no tools)
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (this.activeProvider === 'mock') {
      return this.mockComplete(request);
    }

    if (!this.isConfigured()) {
      console.warn(`Provider ${this.activeProvider} not configured, using mock`);
      return this.mockComplete(request);
    }

    const modelId = request.model || DEFAULT_MODELS[this.activeProvider];
    const model = this.createModel(this.activeProvider, modelId);

    const result = await generateText({
      model,
      messages: convertToAISDKMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens,
      abortSignal: request.abortSignal,
    });

    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const cost = this.calculateCost(this.activeProvider, modelId, inputTokens, outputTokens);

    return {
      content: result.text,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost,
      model: modelId,
    };
  }

  /**
   * Complete with tools - native function calling via AI SDK
   */
  async completeWithTools(
    request: LLMRequest,
    tools: ZodToolDefinition[],
    provider?: LLMProviderType,
    modelId?: string
  ): Promise<LLMResponseWithTools> {
    const activeProvider = provider ?? this.activeProvider;

    if (activeProvider === 'mock') {
      return this.mockCompleteWithTools(request, tools);
    }

    if (!this.isProviderConfigured(activeProvider)) {
      console.warn(`Provider ${activeProvider} not configured, using mock`);
      return this.mockCompleteWithTools(request, tools);
    }

    const actualModelId = modelId || DEFAULT_MODELS[activeProvider];
    const model = this.createModel(activeProvider, actualModelId);

    // Convert ZodToolDefinitions to AI SDK tool format
    // Use zodSchema() for inputSchema, don't pass execute - we handle tool execution separately
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiSdkTools: Record<string, any> = {};
    for (const t of tools) {
      // Debug: log the schema being passed
      console.log(`[LLM] Tool ${t.name}: schema present = ${!!t.schema}, schema type = ${t.schema?.constructor?.name}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const schemaAny = t.schema as any;
      if (schemaAny && typeof schemaAny.shape === 'object') {
        console.log(`[LLM] Tool ${t.name}: schema keys = ${Object.keys(schemaAny.shape).join(', ')}`);
      }

      aiSdkTools[t.name] = tool({
        description: t.description,
        inputSchema: zodSchema(t.schema),
        // No execute - let AI SDK just parse tool calls, we execute separately
      });
    }

    const result = await generateText({
      model,
      messages: convertToAISDKMessages(request.messages),
      tools: aiSdkTools,
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens,
      abortSignal: request.abortSignal,
    });

    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const cost = this.calculateCost(activeProvider, actualModelId, inputTokens, outputTokens);

    // Extract tool calls from result
    const toolCalls: ToolCallResult[] = [];
    if (result.toolCalls) {
      console.log(`[LLM] Raw toolCalls from API:`, JSON.stringify(result.toolCalls, null, 2));
      for (const tc of result.toolCalls) {
        // Log all keys on the tool call object to understand structure
        console.log(`[LLM] Tool call keys:`, Object.keys(tc));
        console.log(`[LLM] Tool call full object:`, JSON.stringify(tc, null, 2));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tcAny = tc as any;
        // Try multiple possible field names for arguments
        const args = tcAny.args ?? tcAny.arguments ?? tcAny.input ?? {};

        // If arguments is a string (JSON), parse it
        const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;

        console.log(`[LLM] Tool call ${tc.toolName}: parsed args =`, JSON.stringify(parsedArgs));
        toolCalls.push({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: parsedArgs,
        });
      }
    }

    // Extract raw response info for debugging
    const rawResponse: RawResponseInfo = {
      responseId: result.response?.id,
      modelId: result.response?.modelId,
      timestamp: result.response?.timestamp,
      headers: result.response?.headers,
      body: result.response?.body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requestBody: (result as any).request?.body as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerMetadata: result.providerMetadata as any,
    };

    return {
      content: result.text,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost,
      model: actualModelId,
      toolCalls,
      finishReason: result.finishReason,
      rawResponse,
    };
  }

  /**
   * Stream completion with tools
   */
  async *streamWithTools(
    request: LLMRequest,
    tools: ZodToolDefinition[],
    provider?: LLMProviderType,
    modelId?: string
  ): AsyncGenerator<{ type: 'text' | 'tool-call'; content: string; toolCall?: ToolCallResult }> {
    const activeProvider = provider ?? this.activeProvider;

    if (activeProvider === 'mock' || !this.isProviderConfigured(activeProvider)) {
      yield { type: 'text', content: 'Mock streaming response' };
      return;
    }

    const actualModelId = modelId || DEFAULT_MODELS[activeProvider];
    const model = this.createModel(activeProvider, actualModelId);

    // Convert ZodToolDefinitions to AI SDK tool format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiSdkTools: Record<string, any> = {};
    for (const t of tools) {
      aiSdkTools[t.name] = tool({
        description: t.description,
        inputSchema: zodSchema(t.schema),
        // No execute - we handle tool execution separately
      });
    }

    const result = streamText({
      model,
      messages: convertToAISDKMessages(request.messages),
      tools: aiSdkTools,
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens,
    });

    for await (const chunk of result.textStream) {
      yield { type: 'text', content: chunk };
    }
  }

  /**
   * Mock completion for testing without API keys
   */
  private mockComplete(request: LLMRequest): LLMResponse {
    const lastMessage = request.messages[request.messages.length - 1];
    return {
      content: `[Mock Response] Received: ${lastMessage.content.substring(0, 100)}...`,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      model: 'mock-model',
    };
  }

  /**
   * Mock completion with tools for testing
   */
  private mockCompleteWithTools(request: LLMRequest, tools: ZodToolDefinition[]): LLMResponseWithTools {
    // Extract the task from the user message for a more helpful mock response
    const userMessage = request.messages.find(m => m.role === 'user')?.content || '';
    const taskMatch = userMessage.match(/Task:\s*({[^}]+}|"[^"]+"|[^\n]+)/);
    let taskDescription = 'the requested task';

    if (taskMatch) {
      try {
        const parsed = JSON.parse(taskMatch[1]);
        taskDescription = parsed.task || parsed.message || taskMatch[1];
      } catch {
        taskDescription = taskMatch[1].replace(/^["']|["']$/g, '');
      }
    }

    const toolNames = tools.map(t => t.name).join(', ');
    const hasTools = tools.length > 0;

    // Provide a mock response that completes the task
    const mockResponse = hasTools
      ? `I've analyzed the task: "${taskDescription}". With access to tools (${toolNames}), I can help accomplish this. [COMPLETE] Task completed successfully: ${taskDescription}`
      : `[COMPLETE] Hello! I've completed the task: ${taskDescription}`;

    return {
      content: mockResponse,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      model: 'mock-model',
      toolCalls: [],
      finishReason: 'stop',
    };
  }

  /**
   * Set Ollama base URL (for custom Ollama installations)
   */
  setOllamaBaseUrl(url: string): void {
    this.ollamaBaseUrl = url;
  }

  /**
   * Load API keys from Tauri SQLite storage
   * Called at app startup to initialize keys before settings panel is opened
   */
  async loadApiKeysFromStorage(): Promise<void> {
    const STORAGE_KEYS: Record<LLMProviderType, string> = {
      openai: 'api-key:openai',
      anthropic: 'api-key:anthropic',
      deepseek: 'api-key:deepseek',
      gemini: 'api-key:gemini',
      cohere: 'api-key:cohere',
      mistral: 'api-key:mistral',
      grok: 'api-key:grok',
      ollama: 'api-key:ollama', // Not used but included for completeness
      mock: 'api-key:mock', // Not used but included for completeness
    };

    try {
      // Dynamic import to avoid circular dependencies
      const tauriDb = await import('../services/tauriDatabase');

      for (const [provider, storageKey] of Object.entries(STORAGE_KEYS)) {
        if (provider === 'mock' || provider === 'ollama') continue;

        try {
          const key = await tauriDb.getSetting(storageKey);
          if (key) {
            this.setApiKey(provider as LLMProviderType, key);
            console.log(`[LLMClient] Loaded API key for ${provider}`);
          }
        } catch {
          // Individual key load failure - continue with others
        }
      }
    } catch (error) {
      console.warn('[LLMClient] Failed to load API keys from Tauri DB:', error);
      // Fallback to localStorage for non-Tauri environments
      this.loadApiKeysFromLocalStorage();
    }
  }

  /**
   * Fallback: Load API keys from localStorage (for non-Tauri environments)
   */
  private loadApiKeysFromLocalStorage(): void {
    const STORAGE_KEYS: Record<string, string> = {
      openai: 'api-key:openai',
      anthropic: 'api-key:anthropic',
      deepseek: 'api-key:deepseek',
      gemini: 'api-key:gemini',
      cohere: 'api-key:cohere',
      mistral: 'api-key:mistral',
      grok: 'api-key:grok',
    };

    for (const [provider, storageKey] of Object.entries(STORAGE_KEYS)) {
      const key = localStorage.getItem(storageKey);
      if (key) {
        this.setApiKey(provider as LLMProviderType, key);
        console.log(`[LLMClient] Loaded API key from localStorage for ${provider}`);
      }
    }
  }
}

// Export singleton instance
export const llmClient = new LLMClient();

// Auto-load API keys on module initialization (handles hot reload)
llmClient.loadApiKeysFromStorage().catch(err => {
  console.warn('[LLMClient] Failed to auto-load API keys on module init:', err);
});

// Also export the class for testing
export { LLMClient };
