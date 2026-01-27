/**
 * Tool Plugin Interface - Self-describing tool plugins
 *
 * Plugins are completely self-describing. The engine and UI learn
 * everything from this interface without hardcoded switches.
 */

import { z } from 'zod';
import type { EventBus } from '../event-bus';
import type { EngineEvent } from '../types';
import { JSONSchema7, ToolDefinition, ZodToolDefinition, ToolResult } from './types';

/**
 * Plugin category determines grouping in UI
 */
export type PluginCategory = 'local' | 'integration' | 'data' | 'communication';

/**
 * Configuration validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: { field: string; message: string }[];
}

/**
 * Health check status
 */
export interface HealthStatus {
  healthy: boolean;
  message?: string;
  lastCheck: Date;
}

/**
 * Execution context provided to every tool call
 */
export interface ExecutionContext {
  entityId: string;
  hexKey: string;
  boardId: string;
  agentId?: string; // Set when called by an agent
  eventBus: EventBus;
  emit: (event: Partial<EngineEvent>) => void;
}

/**
 * UI customization options for plugins
 * Uses metadata rather than React components to avoid circular dependencies.
 * The actual React components are registered separately in the UI layer.
 */
export interface PluginUIConfig {
  /**
   * Tabs for the bottom detail bar
   * The UI layer maps tab IDs to actual React components
   */
  detailTabs?: Array<{
    id: string;
    label: string;
  }>;

  /**
   * Whether this plugin has a custom configuration panel
   * If true, the UI layer will render the corresponding config component
   */
  hasConfigPanel?: boolean;

  /**
   * Default tab to show when this tool is selected
   */
  defaultTab?: string;
}

/**
 * Tool Plugin Interface
 *
 * A plugin fully describes a tool type including:
 * - Identity and metadata
 * - Configuration schema (for auto-generating UI)
 * - Available tools and their schemas
 * - Execution logic
 * - Optional lifecycle hooks
 * - Optional UI customization
 */
export interface ToolPlugin {
  // === Identity ===
  /** Unique plugin identifier (e.g., 'filesystem', 'shell', 'git') */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Icon - SVG string or icon name from icon library */
  icon: string;
  /** Category for UI grouping */
  category: PluginCategory;

  // === Configuration ===
  /** JSON Schema for configuration - used to auto-generate config UI */
  configSchema: JSONSchema7;
  /** Default configuration values */
  defaultConfig: Record<string, unknown>;
  /** Validate configuration and return errors if invalid */
  validateConfig(config: unknown): ValidationResult;

  // === Capabilities ===
  /** Get tool definitions with JSON Schema parameters (for display) */
  getTools(): ToolDefinition[];
  /** Get Zod-based tool definitions (for AI SDK integration) */
  getZodTools?(): ZodToolDefinition[];
  /** Execute a tool by name */
  execute(
    toolName: string,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult>;

  // === Environment ===
  /** Check if plugin is available in current environment (e.g., Tauri) */
  isAvailable(): boolean;

  // === Lifecycle (optional) ===
  /** Initialize plugin with configuration */
  initialize?(config: Record<string, unknown>): Promise<void>;
  /** Cleanup plugin resources */
  dispose?(): Promise<void>;
  /** Check plugin health */
  healthCheck?(): Promise<HealthStatus>;

  // === UI Customization (optional) ===
  ui?: PluginUIConfig;
}

/**
 * Template generated from a plugin for the entity selector
 */
export interface ToolTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: PluginCategory;
  defaultConfig: Record<string, unknown>;
  configSchema: JSONSchema7;
}

/**
 * Helper to create a Zod-validated config schema
 */
export function createConfigSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape);
}

