/**
 * Type definitions for Zustand store
 * Mirrors the existing state types from state/store.ts
 */

import { HexData } from '../hex/grid';

// Re-export board types
export type BoardStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Board type with unified budget naming convention:
 *   max_dollars / max_tokens = budget limits
 *   total_dollars / total_tokens = persistent totals since board creation
 */
export interface Board {
  id: string;
  name: string;
  status: BoardStatus;
  // Budget limits
  max_dollars: number;
  max_tokens: number;
  // Persistent totals (survives agent removal)
  total_dollars: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

// Entity types
export type EntityCategory = 'agent' | 'tool';
export type EntityStatus = 'idle' | 'active' | 'busy' | 'warning' | 'error' | 'disabled';
// ToolType is now a string to support dynamic plugin IDs
// Builtin types: 'filesystem', 'shell', 'tasklist'
// Custom plugins can register any string ID
export type ToolType = string;
export type LinkingMode = 'range' | 'explicit';

export interface EntityMetrics {
  throughput: number;
  errorRate: number;
  latencyMs: number;
  queueDepth: number;
  utilization: number;
  // Per-run metrics (reset each board run)
  llmCallCount: number;  // LLM calls made this run
  runCost: number;       // $ spent this run on this entity
  runTokens: number;     // Tokens processed this run by this entity
}

export interface BaseEntity {
  id: string;
  category: EntityCategory;
  name: string;
  cost: number;
  status: EntityStatus;
  metrics?: EntityMetrics;
}

export interface EquippedRulefile {
  rulefileId: string;
  enabled: boolean;
  overrides?: Record<string, string>;
}

export interface AgentEntity extends BaseEntity {
  category: 'agent';
  template: string;
  provider: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  equippedRulefiles?: EquippedRulefile[];
}

export interface ToolEntity extends BaseEntity {
  category: 'tool';
  toolType: ToolType;
  config: Record<string, unknown>;
  isConfigured: boolean;
  range: number;
  linkingMode: LinkingMode;
  linkedHexes: string[];
  rbacConfig?: RBACConfig;
}

export type Entity = AgentEntity | ToolEntity;

// RBAC types (simplified)
export interface RBACConfig {
  enabled: boolean;
  defaultRole: string;
  defaultPermissions: string[];
  zoneConfig?: {
    readZone: string[];
    writeZone: string[];
    readWriteZone: string[];
    executeInAllZones: boolean;
  };
  useZones: boolean;
  accessGrants: Array<{ entityId: string; permissions: string[] }>;
  denyList: string[];
}

export interface Connection {
  id: string;
  from: string;
  to: string;
  type: 'flow' | 'hierarchy' | 'data';
}

// Resource/Budget system
// Naming convention:
//   max = budget limits (0 = unlimited)
//   total = persistent totals from database
export interface Resources {
  dollars: {
    max: number;         // Budget limit (0 = unlimited)
    total: number;       // Persistent total from database
    projected: number;   // Projected based on current swarm config
    rate: number;        // Current $/hour burn rate
  };
  tokens: {
    max: number;         // Budget limit (0 = unlimited)
    total: number;       // Persistent total from database
    projected: number;   // Projected usage
    rate: number;        // Tokens/hour
  };
}

export interface WorkStats {
  activeAgents: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  tasksPerHour: number;
  // Legacy fields
  queued: number;
  inProgress: number;
  completed: number;
  failed: number;
  throughput: number;
  avgCostPerUnit: number;
  avgTokensPerUnit: number;
}

export interface MetricPoint {
  timestamp: number;
  value: number;
}

export interface Metrics {
  costOverTime: MetricPoint[];
  throughputOverTime: MetricPoint[];
  queueDepthOverTime: MetricPoint[];
}

// Re-export HexData
export type { HexData };

