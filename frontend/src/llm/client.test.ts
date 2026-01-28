import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { LLMClient } from './client';
import { LLMProviderType } from './types';
import { ZodToolDefinition } from '../engine/tools/types';

describe('LLMClient', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient();
  });

  describe('provider configuration', () => {
    it('defaults to mock provider', () => {
      expect(client.getProvider()).toBe('mock');
    });

    it('can set provider', () => {
      client.setProvider('openai');
      expect(client.getProvider()).toBe('openai');
    });

    it('mock provider is always configured', () => {
      expect(client.isProviderConfigured('mock')).toBe(true);
    });

    it('ollama provider is always configured (no API key needed)', () => {
      expect(client.isProviderConfigured('ollama')).toBe(true);
    });

    it('cloud providers are not configured without API key', () => {
      expect(client.isProviderConfigured('openai')).toBe(false);
      expect(client.isProviderConfigured('anthropic')).toBe(false);
      expect(client.isProviderConfigured('gemini')).toBe(false);
    });

    it('can set and get API keys', () => {
      client.setApiKey('openai', 'test-key');
      expect(client.getApiKey('openai')).toBe('test-key');
      expect(client.isProviderConfigured('openai')).toBe(true);
    });

    it('removes API key when set to empty string', () => {
      client.setApiKey('openai', 'test-key');
      client.setApiKey('openai', '');
      expect(client.getApiKey('openai')).toBeUndefined();
      expect(client.isProviderConfigured('openai')).toBe(false);
    });

    it('isConfigured checks active provider', () => {
      expect(client.isConfigured()).toBe(true); // mock is default
      client.setProvider('openai');
      expect(client.isConfigured()).toBe(false); // openai not configured
    });
  });

  describe('getConfiguredProviders', () => {
    it('includes mock and ollama by default', () => {
      const providers = client.getConfiguredProviders();
      expect(providers).toContain('mock');
      expect(providers).toContain('ollama');
    });

    it('includes providers with API keys', () => {
      client.setApiKey('openai', 'key1');
      client.setApiKey('anthropic', 'key2');
      const providers = client.getConfiguredProviders();
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
    });
  });

  describe('getAvailableProviders', () => {
    it('returns all supported providers', () => {
      const providers = client.getAvailableProviders();
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).toContain('deepseek');
      expect(providers).toContain('gemini');
      expect(providers).toContain('cohere');
      expect(providers).toContain('mistral');
      expect(providers).toContain('ollama');
      expect(providers).toContain('grok');
      expect(providers).toContain('mock');
    });
  });

  describe('getDefaultModelForProvider', () => {
    it('returns correct default model for each provider', () => {
      expect(client.getDefaultModelForProvider('openai')).toBe('gpt-4o-mini');
      expect(client.getDefaultModelForProvider('anthropic')).toBe('claude-3-5-sonnet-20241022');
      expect(client.getDefaultModelForProvider('deepseek')).toBe('deepseek-chat');
      expect(client.getDefaultModelForProvider('gemini')).toBe('gemini-2.0-flash');
      expect(client.getDefaultModelForProvider('cohere')).toBe('command-r');
      expect(client.getDefaultModelForProvider('mistral')).toBe('mistral-small-latest');
      expect(client.getDefaultModelForProvider('ollama')).toBe('llama3.2');
      expect(client.getDefaultModelForProvider('grok')).toBe('grok-2');
      expect(client.getDefaultModelForProvider('mock')).toBe('mock-model');
    });

    it('returns mock-model for unknown provider', () => {
      expect(client.getDefaultModelForProvider('unknown' as LLMProviderType)).toBe('mock-model');
    });

    it('returns provider-appropriate model when switching providers', () => {
      // This tests the fix for GitHub issue #1: Ollama using claude-3-5-sonnet
      // When switching from Anthropic to Ollama, the model should change to llama3.2
      const anthropicDefault = client.getDefaultModelForProvider('anthropic');
      const ollamaDefault = client.getDefaultModelForProvider('ollama');

      expect(anthropicDefault).toBe('claude-3-5-sonnet-20241022');
      expect(ollamaDefault).toBe('llama3.2');
      expect(anthropicDefault).not.toBe(ollamaDefault);
    });
  });

  describe('getModelsForProvider', () => {
    it('returns models for openai', async () => {
      const models = await client.getModelsForProvider('openai');
      expect(models.length).toBeGreaterThan(0);
      expect(models.find(m => m.id === 'gpt-4o')).toBeDefined();
    });

    it('returns models for anthropic', async () => {
      const models = await client.getModelsForProvider('anthropic');
      expect(models.length).toBeGreaterThan(0);
      expect(models.find(m => m.id.includes('claude'))).toBeDefined();
    });

    it('returns empty array for unknown provider', async () => {
      const models = await client.getModelsForProvider('unknown' as LLMProviderType);
      expect(models).toEqual([]);
    });
  });

  describe('complete (mock)', () => {
    it('returns mock response with content', async () => {
      const response = await client.complete({
        messages: [{ role: 'user', content: 'Hello, world!' }],
      });
      expect(response.content).toContain('[Mock Response]');
      expect(response.content).toContain('Hello, world!');
    });

    it('returns usage stats', async () => {
      const response = await client.complete({
        messages: [{ role: 'user', content: 'Test' }],
      });
      expect(response.usage).toBeDefined();
      expect(response.usage.promptTokens).toBeGreaterThan(0);
      expect(response.usage.completionTokens).toBeGreaterThan(0);
    });

    it('returns cost information', async () => {
      const response = await client.complete({
        messages: [{ role: 'user', content: 'Test' }],
      });
      expect(response.cost).toBeDefined();
      expect(response.cost.totalCost).toBeDefined();
    });
  });

  describe('completeWithTools (mock)', () => {
    const testTools: ZodToolDefinition[] = [
      {
        name: 'read_file',
        description: 'Read a file from the filesystem',
        schema: z.object({ path: z.string() }),
        execute: async () => ({ success: true, content: 'file content' }),
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        schema: z.object({ path: z.string(), content: z.string() }),
        execute: async () => ({ success: true }),
      },
    ];

    it('returns response with finishReason', async () => {
      const response = await client.completeWithTools(
        { messages: [{ role: 'user', content: 'Test' }] },
        testTools
      );
      expect(response.finishReason).toBe('stop');
    });

    it('lists available tools in mock response', async () => {
      const response = await client.completeWithTools(
        { messages: [{ role: 'user', content: 'Test' }] },
        testTools
      );
      expect(response.content).toContain('read_file');
      expect(response.content).toContain('write_file');
    });

    it('returns empty toolCalls array in mock mode', async () => {
      const response = await client.completeWithTools(
        { messages: [{ role: 'user', content: 'Test' }] },
        testTools
      );
      expect(response.toolCalls).toEqual([]);
    });

    it('falls back to mock when provider not configured', async () => {
      client.setProvider('openai'); // Not configured
      const response = await client.completeWithTools(
        { messages: [{ role: 'user', content: 'Test' }] },
        testTools
      );
      // Mock response includes [COMPLETE] and mentions available tools
      expect(response.content).toContain('[COMPLETE]');
      expect(response.content).toContain('read_file');
    });
  });

  describe('Ollama base URL', () => {
    it('has default localhost URL', () => {
      expect(client.getOllamaBaseUrl()).toBe('http://localhost:11434/v1');
    });

    it('can set custom Ollama URL', () => {
      client.setOllamaBaseUrl('http://custom:11434/v1');
      expect(client.getOllamaBaseUrl()).toBe('http://custom:11434/v1');
    });

    it('can set remote Ollama URL', () => {
      // Test case for users running Ollama over VPN or on remote server
      client.setOllamaBaseUrl('https://ollama.internalnet.com/v1');
      expect(client.getOllamaBaseUrl()).toBe('https://ollama.internalnet.com/v1');
    });
  });
});

