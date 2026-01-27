import { HexData } from '../hex/grid';
import { BoardRunner } from '../engine/board-runner';
import { eventBus as globalEventBus } from '../engine/event-bus';
import { workQueue as globalWorkQueue } from '../engine/work-queue';
import { EngineEvent } from '../engine/types';
import * as tauriDb from '../services/tauriDatabase';
import { RBACConfig, DEFAULT_RBAC_CONFIG } from '../rbac/types';
import { llmClient } from '../llm/client';

// Re-export board types from tauriDatabase
export type Board = tauriDb.Board;
export type BoardStatus = tauriDb.BoardStatus;

// Entity categories - simplified to core types for local agent swarms
export type EntityCategory = 'agent' | 'tool';

// Base entity interface - all board entities share these
export type EntityStatus = 'idle' | 'active' | 'busy' | 'warning' | 'error' | 'disabled';

export interface EntityMetrics {
  throughput: number;      // units/hour
  errorRate: number;       // 0-1
  latencyMs: number;       // average response time
  queueDepth: number;      // items waiting
  utilization: number;     // 0-1, how busy
  // Per-run metrics (reset each board run, drives hex height growth)
  runCost: number;         // $ spent this run on this entity
  runTokens: number;       // Tokens processed this run by this entity
  llmCallCount?: number;   // LLM calls made this run
}

export interface BaseEntity {
  id: string;
  category: EntityCategory;
  name: string;
  cost: number; // $/hour - drives hex height
  status: EntityStatus;
  metrics?: EntityMetrics;
}

// Equipped rulefile reference (from rulefiles module)
export interface EquippedRulefile {
  rulefileId: string;
  enabled: boolean;
  overrides?: Record<string, string>; // Rule ID -> overridden content
}

// Agent - LLM-powered thinking/planning/generating
export interface AgentEntity extends BaseEntity {
  category: 'agent';
  template: string; // planner, coder, reviewer
  provider: string; // openai, anthropic, deepseek, etc.
  model: string; // gpt-4, claude-3, etc.
  systemPrompt: string;
  temperature: number;
  equippedRulefiles?: EquippedRulefile[]; // Optional rulefiles equipped to this agent
}

// Tool - Local tools for filesystem, shell, and task list
// ToolType is now a string to support dynamic plugin IDs
// Builtin types: 'filesystem', 'shell', 'tasklist'
// Custom plugins can register any string ID
export type ToolType = string;

// Linking modes for RBAC
export type LinkingMode = 'range' | 'explicit';

export interface ToolEntity extends BaseEntity {
  category: 'tool';
  toolType: ToolType;
  config: Record<string, unknown>;
  isConfigured: boolean;
  // Range-based access control
  range: number;              // How many hexes away this tool's effects reach
  linkingMode: LinkingMode;   // 'range' for proximity-based, 'explicit' for manual links
  linkedHexes: string[];      // Explicitly linked hex keys (when linkingMode is 'explicit')
  rbacConfig?: RBACConfig;    // RBAC zone configuration for directional access control
}

// Union type for all entities
export type Entity = AgentEntity | ToolEntity;

// Entity templates for quick creation
// Simplified to core types for local coding agent swarm
// System prompts are generated dynamically by the prompt builder based on template type, RBAC, and tool access
export const ENTITY_TEMPLATES: Record<EntityCategory, Record<string, Partial<Entity>>> = {
  agent: {
    // Core agents for coding workflows - prompts generated dynamically by prompt builder
    planner: { name: 'Planner', template: 'planner', model: 'claude-3-5-sonnet', cost: 30, temperature: 0.7 },
    coder: { name: 'Coder', template: 'coder', model: 'claude-3-5-sonnet', cost: 40, temperature: 0.2 },
    reviewer: { name: 'Reviewer', template: 'reviewer', model: 'claude-3-5-sonnet', cost: 25, temperature: 0.3 },
  },
  tool: {
    // Local tools for coding workflows
    filesystem: {
      name: 'Filesystem',
      toolType: 'filesystem',
      cost: 0,
      isConfigured: false,
      config: { rootPath: '' },  // User must configure the workspace path
      range: 1,
      linkingMode: 'range',
      linkedHexes: [],
      rbacConfig: DEFAULT_RBAC_CONFIG,
    },
    shell: {
      name: 'Shell',
      toolType: 'shell',
      cost: 0,
      isConfigured: true,
      config: { shell: 'bash', allowedCommands: [] },
      range: 1,
      linkingMode: 'range',
      linkedHexes: [],
      rbacConfig: DEFAULT_RBAC_CONFIG,
    },
    tasklist: {
      name: 'Task List',
      toolType: 'tasklist',
      cost: 0,
      isConfigured: false,
      config: { filePath: './tasks.md' },  // Default task list file
      range: 1,
      linkingMode: 'range',
      linkedHexes: [],
      rbacConfig: DEFAULT_RBAC_CONFIG,
    },
  },
};

// Colors for each category
export const ENTITY_COLORS: Record<EntityCategory, number> = {
  agent: 0x22c55e,    // green
  tool: 0x06b6d4,     // cyan
};

export interface Connection {
  id: string;
  from: string; // hex key
  to: string;   // hex key
  type: 'flow' | 'hierarchy' | 'data';
}

// Resource/Budget system
// Naming convention:
//   maxDollars / maxTokens = budget limits
//   totalDollars / totalTokens = persistent totals from database
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

// Work tracking
export interface WorkStats {
  activeAgents: number;     // Agents currently in 'active' status
  pendingTasks: number;     // Tasks waiting to be claimed (pending status)
  inProgressTasks: number;  // Tasks currently being processed
  completedTasks: number;   // Tasks completed this session
  tasksPerHour: number;     // Rolling average tasks completed per hour
  // Legacy fields kept for compatibility
  queued: number;
  inProgress: number;
  completed: number;
  failed: number;
  throughput: number;
  avgCostPerUnit: number;
  avgTokensPerUnit: number;
}

// Time-series data point for charts
export interface MetricPoint {
  timestamp: number;
  value: number;
}

export interface Metrics {
  costOverTime: MetricPoint[];
  throughputOverTime: MetricPoint[];
  queueDepthOverTime: MetricPoint[];
}

export interface AppState {
  // Board management (from backend)
  boards: Board[];
  board: Board | null;
  boardLoading: boolean;
  boardError: string | null;

  // Board state (local)
  hexes: Map<string, HexData>;
  entities: Map<string, Entity>;
  connections: Connection[];

  // Selection state
  selectedHex: string | null;
  selectedEntity: string | null;

  // UI interaction state
  isPanning: boolean;
  isConnecting: boolean;
  connectingFrom: string | null;

  // Resources & Work
  resources: Resources;
  work: WorkStats;
  metrics: Metrics;

  // Swarm status (derived from board.status)
  swarmStatus: 'stopped' | 'running' | 'paused';

  // Preview state (not persisted, for live UI updates)
  previewRange: number | null;  // Preview range for slider dragging
}

type Listener = () => void;

export class Store {
  private state: AppState;
  private listeners: Set<Listener>;

  // Local execution engine
  private localRunner: BoardRunner | null = null;
  private engineEventCleanup: (() => void) | null = null;

  constructor() {
    this.state = {
      boards: [],
      board: null,
      boardLoading: false,
      boardError: null,
      hexes: new Map(),
      entities: new Map(),
      connections: [],
      selectedHex: null,
      selectedEntity: null,
      isPanning: false,
      isConnecting: false,
      connectingFrom: null,
      resources: {
        dollars: { max: 500, total: 0, projected: 0, rate: 0 },
        tokens: { max: 10_000_000, total: 0, projected: 0, rate: 0 },
      },
      work: {
        activeAgents: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        completedTasks: 0,
        tasksPerHour: 0,
        // Legacy fields
        queued: 0,
        inProgress: 0,
        completed: 0,
        failed: 0,
        throughput: 0,
        avgCostPerUnit: 0,
        avgTokensPerUnit: 0,
      },
      metrics: {
        costOverTime: [],
        throughputOverTime: [],
        queueDepthOverTime: [],
      },
      swarmStatus: 'stopped',
      previewRange: null,
    };
    this.listeners = new Set();
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    // Recalculate work stats on every UI update for real-time display
    this.updateWorkStatsFromBoard();
    this.listeners.forEach(l => l());
  }

  /**
   * Update work stats from board state (non-notifying, called by notify())
   */
  private updateWorkStatsFromBoard(): void {
    // Count active agents
    let activeAgents = 0;
    for (const entity of this.state.entities.values()) {
      if (entity.category === 'agent' && entity.status === 'active') {
        activeAgents++;
      }
    }
    this.state.work.activeAgents = activeAgents;

    // Count pending and in-progress tasks across all actors (agents and tasklists)
    let pendingTasks = 0;
    let inProgressTasks = 0;

    if (this.localRunner) {
      // Build a map of entity ID to hex key
      const entityToHexKey = new Map<string, string>();
      for (const [hexKey, hex] of this.state.hexes.entries()) {
        if (hex.entityId) {
          entityToHexKey.set(hex.entityId, hexKey);
        }
      }

      for (const entity of this.state.entities.values()) {
        const hexKey = entityToHexKey.get(entity.id);
        if (!hexKey) continue;

        // Get actor for this entity
        const actor = this.localRunner.getActor(hexKey) as unknown as {
          getQueueStatus?: () => { pending: number; processing: number };
          getWorkStatus?: () => { pending: number; processing: number };
        } | undefined;

        if (entity.category === 'tool' && (entity as ToolEntity).toolType === 'tasklist') {
          // Tasklist tools have getQueueStatus
          if (actor && typeof actor.getQueueStatus === 'function') {
            const status = actor.getQueueStatus();
            pendingTasks += status.pending;
            inProgressTasks += status.processing;
          }
        } else if (entity.category === 'agent') {
          // Agents have getWorkStatus (from BaseActor)
          if (actor && typeof actor.getWorkStatus === 'function') {
            const status = actor.getWorkStatus();
            pendingTasks += status.pending;
            inProgressTasks += status.processing;
          }
        }
      }
    }

    this.state.work.pendingTasks = pendingTasks;
    this.state.work.inProgressTasks = inProgressTasks;
  }

  // Preview state updates (triggers notify for renderer but UI components can ignore)
  setPreviewRange(range: number | null): void {
    this.state.previewRange = range;
    this.notify();  // Will trigger renderer update
  }

  // Hex operations
  addHex(hex: HexData): void {
    this.state.hexes.set(hex.key, hex);
    this.notify();
  }

  selectHex(key: string | null): void {
    this.state.selectedHex = key;
    if (key) {
      const hex = this.state.hexes.get(key);
      this.state.selectedEntity = hex?.entityId ?? null;
    } else {
      this.state.selectedEntity = null;
    }
    this.notify();
  }

  // Entity operations
  addEntity(entity: Entity, hexKey: string): void {
    this.state.entities.set(entity.id, entity);
    const hex = this.state.hexes.get(hexKey);
    if (hex) {
      hex.entityId = entity.id;
    }
    this.recalculateProjectionsInternal();
    this.notify();
  }

  updateEntity(entityId: string, updates: Partial<Entity>): void {
    const entity = this.state.entities.get(entityId);
    if (entity) {
      Object.assign(entity, updates);
      this.notify();
      // Schedule auto-save for this entity
      this.scheduleEntitySave(entityId);
    }
  }

  /**
   * Update entity and save immediately (no debounce)
   * Use for critical user actions like equipping rulefiles
   */
  async updateEntityImmediate(entityId: string, updates: Partial<Entity>): Promise<void> {
    const entity = this.state.entities.get(entityId);
    if (entity) {
      Object.assign(entity, updates);
      this.notify();
      // Clear any pending debounced save for this entity
      const existingTimer = this.entitySaveTimers.get(entityId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.entitySaveTimers.delete(entityId);
      }
      // Save immediately
      await this.saveEntityToDatabase(entityId);
    }
  }

  /**
   * Add accumulated cost and tokens to an entity (from LLM API calls).
   * This causes the hex height to grow over time as costs accrue.
   */
  addEntityCost(entityId: string, cost: number, tokens: number): void {
    const entity = this.state.entities.get(entityId);
    if (!entity) return;

    // Initialize metrics if not present
    if (!entity.metrics) {
      entity.metrics = {
        throughput: 0,
        errorRate: 0,
        latencyMs: 0,
        queueDepth: 0,
        utilization: 0,
        runCost: 0,
        runTokens: 0,
        llmCallCount: 0,
      };
    }

    // Accumulate run cost and tokens (per-run, resets on board restart)
    entity.metrics.runCost = (entity.metrics.runCost || 0) + cost;
    entity.metrics.runTokens = (entity.metrics.runTokens || 0) + tokens;
    entity.metrics.llmCallCount = (entity.metrics.llmCallCount || 0) + 1;

    // Update global metrics
    this.addMetricPoint('costOverTime', entity.metrics.runCost);

    this.notify();
    // Schedule auto-save to persist accumulated costs
    this.scheduleEntitySave(entityId);
  }

  /**
   * Get run cost for an entity (for hex height calculation)
   * This is the per-run cost that resets when the board restarts.
   */
  getEntityRunCost(entityId: string): number {
    const entity = this.state.entities.get(entityId);
    return entity?.metrics?.runCost || 0;
  }

  // Debounce timers for entity saves
  private entitySaveTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private static SAVE_DEBOUNCE_MS = 1000;

  // Schedule a debounced save for an entity
  private scheduleEntitySave(entityId: string): void {
    // Clear existing timer for this entity
    const existingTimer = this.entitySaveTimers.get(entityId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new save
    const timer = setTimeout(async () => {
      await this.saveEntityToDatabase(entityId);
      this.entitySaveTimers.delete(entityId);
    }, Store.SAVE_DEBOUNCE_MS);

    this.entitySaveTimers.set(entityId, timer);
  }

  /**
   * Flush all pending entity saves immediately
   * Call this before page unload or when stopping execution
   */
  async flushPendingEntitySaves(): Promise<void> {
    const pendingEntityIds = Array.from(this.entitySaveTimers.keys());
    if (pendingEntityIds.length === 0) return;

    console.log(`[Store] Flushing ${pendingEntityIds.length} pending entity saves`);

    // Clear all timers
    for (const timer of this.entitySaveTimers.values()) {
      clearTimeout(timer);
    }
    this.entitySaveTimers.clear();

    // Save all pending entities
    await Promise.all(
      pendingEntityIds.map(entityId => this.saveEntityToDatabase(entityId))
    );
  }

  // Persist entity changes to database
  private async saveEntityToDatabase(entityId: string): Promise<void> {
    if (!this.state.board) return;

    const entity = this.state.entities.get(entityId);
    if (!entity) return;

    try {
      // Build config object from entity data (excluding id, category, name, status, cost)
      const { id, category, name, status, cost, ...config } = entity;
      const configToSave = { ...config, cost };
      console.log(`[saveEntityToDatabase] Saving entity ${entityId} (${entity.name}), config:`, JSON.stringify(configToSave));
      if (entity.category === 'agent' && 'equippedRulefiles' in entity) {
        console.log(`[saveEntityToDatabase] Agent has equippedRulefiles:`, (entity as AgentEntity).equippedRulefiles);
      }
      await tauriDb.updateHex(entityId, {
        name: entity.name,
        status: entity.status,
        config: configToSave,
      });
      console.debug(`Auto-saved entity ${entityId}`);
    } catch (error) {
      console.error(`Failed to auto-save entity ${entityId}:`, error);
    }
  }

  // Note: toggleLinkedHex removed - linking feature not used in simplified entity model

  async removeEntity(entityId: string): Promise<void> {
    // Find hex with this entity
    this.state.hexes.forEach(hex => {
      if (hex.entityId === entityId) {
        hex.entityId = undefined;
      }
    });
    // Remove connections involving this entity
    this.state.connections = this.state.connections.filter(conn => {
      const fromHex = this.state.hexes.get(conn.from);
      const toHex = this.state.hexes.get(conn.to);
      return fromHex?.entityId !== entityId && toHex?.entityId !== entityId;
    });
    this.state.entities.delete(entityId);
    this.recalculateProjectionsInternal();
    this.notify();

    // Delete from database if connected
    if (this.state.board) {
      try {
        await tauriDb.deleteHex(entityId);
      } catch (error) {
        console.error('Failed to delete entity from database:', error);
      }
    }
  }

  // Clear all entities from the board (for board switching)
  clearAllEntities(): void {
    // Clear entity references from hexes
    this.state.hexes.forEach(hex => {
      hex.entityId = undefined;
    });
    // Clear all entities and connections
    this.state.entities.clear();
    this.state.connections = [];
    this.recalculateProjectionsInternal();
    this.notify();
  }

  getEntity(entityId: string): Entity | undefined {
    return this.state.entities.get(entityId);
  }

  // Connection operations
  async addConnection(from: string, to: string, type: Connection['type'] = 'flow'): Promise<void> {
    // Don't add duplicate connections
    const exists = this.state.connections.some(c =>
      (c.from === from && c.to === to) || (c.from === to && c.to === from)
    );
    if (!exists) {
      // Get entity IDs from hex keys
      const fromHex = this.state.hexes.get(from);
      const toHex = this.state.hexes.get(to);
      const fromEntityId = fromHex?.entityId;
      const toEntityId = toHex?.entityId;

      let connectionId = `${from}-${to}`;

      // Persist to database if we have entity IDs and a board
      if (this.state.board && fromEntityId && toEntityId) {
        try {
          const dbConn = await tauriDb.createConnection(
            this.state.board.id,
            fromEntityId,
            toEntityId,
            type
          );
          connectionId = dbConn.id;
        } catch (error) {
          console.error('Failed to save connection to database:', error);
        }
      }

      this.state.connections.push({
        id: connectionId,
        from,
        to,
        type,
      });
      this.notify();
    }
  }

  async removeConnection(connectionId: string): Promise<void> {
    // Delete from database if connected
    if (this.state.board) {
      try {
        await tauriDb.deleteConnection(connectionId);
      } catch (error) {
        console.error('Failed to delete connection from database:', error);
      }
    }
    this.state.connections = this.state.connections.filter(c => c.id !== connectionId);
    this.notify();
  }

  // UI state
  setPanning(isPanning: boolean): void {
    this.state.isPanning = isPanning;
  }

  startConnecting(fromHexKey: string): void {
    this.state.isConnecting = true;
    this.state.connectingFrom = fromHexKey;
    this.notify();
  }

  endConnecting(): void {
    this.state.isConnecting = false;
    this.state.connectingFrom = null;
    this.notify();
  }

  // Resource operations
  // Set budget limits (max dollars/tokens)
  setMaxBudget(maxDollars: number, maxTokens: number): void {
    this.state.resources.dollars.max = maxDollars;
    this.state.resources.tokens.max = maxTokens;
    this.notify();
  }

  // Update persistent totals (from database)
  setTotals(totalDollars: number, totalTokens: number): void {
    this.state.resources.dollars.total = totalDollars;
    this.state.resources.tokens.total = totalTokens;
    this.notify();
  }

  updateResources(dollars: Partial<Resources['dollars']>, tokens: Partial<Resources['tokens']>): void {
    Object.assign(this.state.resources.dollars, dollars);
    Object.assign(this.state.resources.tokens, tokens);
    this.notify();
  }

  // Work operations
  updateWork(updates: Partial<WorkStats>): void {
    Object.assign(this.state.work, updates);
    this.notify();
  }

  addWorkToQueue(count: number): void {
    this.state.work.queued += count;
    this.notify();
  }

  // Swarm control
  setSwarmStatus(status: AppState['swarmStatus']): void {
    this.state.swarmStatus = status;
    this.notify();
  }

  // Metrics - add a data point
  addMetricPoint(metric: keyof Metrics, value: number): void {
    const point: MetricPoint = { timestamp: Date.now(), value };
    this.state.metrics[metric].push(point);
    // Keep last 100 points
    if (this.state.metrics[metric].length > 100) {
      this.state.metrics[metric].shift();
    }
    this.notify();
  }

  // Internal projection calculation (no notify, prevents loops)
  private recalculateProjectionsInternal(): void {
    let projectedDollars = 0;
    let projectedTokens = 0;

    this.state.entities.forEach(entity => {
      // Cost is now directly in $/hour
      projectedDollars += entity.cost;
      projectedTokens += 100000; // Rough token estimate per entity per hour
    });

    this.state.resources.dollars.projected = projectedDollars;
    this.state.resources.dollars.rate = projectedDollars;
    this.state.resources.tokens.projected = projectedTokens;
    this.state.resources.tokens.rate = projectedTokens;
  }

  // Calculate projected costs based on current swarm configuration (with notify)
  recalculateProjections(): void {
    this.recalculateProjectionsInternal();
    this.notify();
  }

  // Initialize a hex grid (for testing and setup)
  initializeGrid(radius: number): void {
    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) {
        const key = `${q},${r}`;
        const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
        if (dist <= radius) {
          this.state.hexes.set(key, {
            coord: { q, r },
            key,
            isEdge: dist === radius,
          });
        }
      }
    }
  }

  // Place an entity on a hex (convenience method)
  // Accepts partial entity data - id, name, cost, status are optional and will be auto-generated
  // Now async to persist to database
  async placeEntity(hexKey: string, entityData: Partial<Entity> & { category: EntityCategory }): Promise<Entity> {
    const template = ENTITY_TEMPLATES[entityData.category];
    const templateKey = Object.keys(template)[0];
    const templateData = template[templateKey];

    // For agent entities, use the first configured provider/model if not explicitly specified
    let agentDefaults: Partial<AgentEntity> = {};
    if (entityData.category === 'agent') {
      const agentData = entityData as Partial<AgentEntity>;
      // Only apply defaults if provider/model are not explicitly set
      if (!agentData.provider || !agentData.model) {
        const defaults = llmClient.getDefaultProviderAndModel();
        if (!agentData.provider) {
          agentDefaults.provider = defaults.provider;
        }
        if (!agentData.model) {
          agentDefaults.model = defaults.model;
        }
      }
    }

    const entity: Entity = {
      id: `entity-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: entityData.name || templateData.name || entityData.category,
      cost: entityData.cost ?? templateData.cost ?? 0,
      status: entityData.status || 'idle',
      ...templateData,
      ...entityData,
      ...agentDefaults,
    } as Entity;

    // Add locally first
    this.addEntity(entity, hexKey);

    // Persist to database if connected
    console.log(`[placeEntity] Board state:`, this.state.board ? `${this.state.board.name} (${this.state.board.id})` : 'null');
    if (this.state.board) {
      try {
        const [q, r] = hexKey.split(',').map(Number);
        console.log(`[placeEntity] Saving entity to DB - board: ${this.state.board.id}, hex: ${hexKey}, entity: ${entity.name}`);
        // Build config from the complete entity (not just entityData) to include template defaults
        const { id: _id, category: _cat, name: _name, status: _status, ...entityConfig } = entity;
        const dbHex = await tauriDb.createHex(this.state.board.id, {
          name: entity.name,
          category: entity.category,
          entityType: (entityData as Record<string, unknown>).template as string || templateKey || entity.category,
          positionQ: q,
          positionR: r,
          config: entityConfig,
        });
        console.log(`[placeEntity] Entity saved to DB with id: ${dbHex.id}`);
        // Update local entity with the database-generated ID
        this.state.entities.delete(entity.id);
        entity.id = dbHex.id;
        this.state.entities.set(entity.id, entity);
        const hex = this.state.hexes.get(hexKey);
        if (hex) {
          hex.entityId = entity.id;
        }
        this.notify();
      } catch (error) {
        console.error('[placeEntity] Failed to save entity to database:', error);
      }
    } else {
      console.warn('[placeEntity] No board set, entity not saved to database!');
    }

    return entity;
  }

  // === Board Operations (SQLite via Tauri) ===

  // Load all boards and select the first one (or create default)
  async loadBoards(): Promise<void> {
    this.state.boardLoading = true;
    this.state.boardError = null;
    this.notify();

    try {
      // Load all boards from local SQLite
      const boards = await tauriDb.listBoards();
      this.state.boards = boards;

      // Select first board or create default
      if (boards.length > 0) {
        await this.selectBoard(boards[0].id);
      } else {
        await this.createNewBoard('Default Board');
      }

      this.state.boardLoading = false;
      this.notify();
    } catch (error) {
      this.state.boardLoading = false;
      this.state.boardError = error instanceof Error ? error.message : 'Failed to load boards';
      this.notify();
    }
  }

  // Select a board by ID
  async selectBoard(boardId: string): Promise<void> {
    console.log(`[selectBoard] Selecting board ${boardId}`);
    this.state.boardLoading = true;
    this.state.boardError = null;
    this.notify();

    try {
      // Clear current entities before loading new board
      console.log(`[selectBoard] Clearing entities. Hex grid size: ${this.state.hexes.size}`);
      this.clearAllEntities();
      console.log(`[selectBoard] After clear - Hex grid size: ${this.state.hexes.size}, Entities: ${this.state.entities.size}`);

      const board = await tauriDb.getBoard(boardId);
      console.log(`[selectBoard] Loaded board: ${board.name} (${board.id})`);
      this.state.board = board;
      this.syncBoardToState(board);

      // Load hexes from the database
      const hexes = await tauriDb.listHexes(boardId);
      console.log(`[selectBoard] Got ${hexes.length} hexes from database`);
      this.loadHexesFromDB(hexes);

      // Load connections
      const connections = await tauriDb.listConnections(boardId);
      console.log(`[selectBoard] Got ${connections.length} connections from database`);
      this.loadConnectionsFromDB(connections);

      this.state.boardLoading = false;
      console.log(`[selectBoard] Board loaded. Entities: ${this.state.entities.size}, Connections: ${this.state.connections.length}`);
      this.notify();
    } catch (error) {
      console.error(`[selectBoard] Error loading board:`, error);
      this.state.boardLoading = false;
      this.state.boardError = error instanceof Error ? error.message : 'Failed to load board';
      this.notify();
    }
  }

  // Load hexes from database into local state
  private loadHexesFromDB(dbHexes: tauriDb.HexEntity[]): void {
    console.log(`[loadHexesFromDB] Loading ${dbHexes.length} hexes from DB`);
    console.log(`[loadHexesFromDB] Current hex grid size: ${this.state.hexes.size}`);

    for (const dbHex of dbHexes) {
      const hexKey = `${dbHex.position_q},${dbHex.position_r}`;
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(dbHex.config || '{}');
      } catch {
        config = {};
      }

      // Apply defaults for tool entities to handle older DB entries missing required fields
      const category = dbHex.category as EntityCategory;
      if (category === 'tool') {
        // Ensure required ToolEntity fields have defaults
        if (!config.range) config.range = 1;
        if (!config.linkingMode) config.linkingMode = 'range';
        if (!config.linkedHexes) config.linkedHexes = [];
        if (config.isConfigured === undefined) config.isConfigured = false;
        if (!config.config) config.config = {};
      }

      // Create entity from DB hex data
      const entity = {
        id: dbHex.id,
        category,
        cost: (config.cost as number) || 10,
        status: dbHex.status === 'active' ? 'active' : dbHex.status === 'error' ? 'error' : 'idle',
        name: dbHex.name,
        ...config,
      } as Entity;

      // Add entity to state
      this.state.entities.set(entity.id, entity);
      console.log(`[loadHexesFromDB] Added entity ${entity.id} (${entity.name}) at ${hexKey}, toolType: ${(config as Record<string, unknown>).toolType}`);
      if (category === 'agent' && config.equippedRulefiles) {
        console.log(`[loadHexesFromDB] Agent has equippedRulefiles from DB:`, config.equippedRulefiles);
      }

      // Link to hex
      const hex = this.state.hexes.get(hexKey);
      if (hex) {
        hex.entityId = entity.id;
        console.log(`[loadHexesFromDB] Linked entity ${entity.id} to hex ${hexKey}`);
      } else {
        console.warn(`[loadHexesFromDB] No hex found at ${hexKey} - cannot link entity!`);
      }
    }

    console.log(`[loadHexesFromDB] Total entities after loading: ${this.state.entities.size}`);
  }

  // Load connections from database
  private loadConnectionsFromDB(dbConnections: tauriDb.Connection[]): void {
    for (const conn of dbConnections) {
      this.state.connections.push({
        id: conn.id,
        from: conn.from_hex_id,
        to: conn.to_hex_id,
        type: conn.connection_type as 'flow' | 'hierarchy' | 'data',
      });
    }
  }

  // Create a new board (starts with blank canvas)
  async createNewBoard(name: string): Promise<Board | null> {
    this.state.boardLoading = true;
    this.state.boardError = null;
    this.notify();

    try {
      const board = await tauriDb.createBoard(
        name,
        this.state.resources.dollars.max,
        this.state.resources.tokens.max
      );

      // Add to boards list
      this.state.boards = [...this.state.boards, board];

      // Clear all entities for a blank canvas
      this.clearAllEntities();

      // Select the new board
      this.state.board = board;
      this.syncBoardToState(board);
      this.state.boardLoading = false;
      this.notify();

      return board;
    } catch (error) {
      this.state.boardLoading = false;
      this.state.boardError = error instanceof Error ? error.message : 'Failed to create board';
      this.notify();
      return null;
    }
  }

  // Delete a board by ID
  async deleteBoard(boardId: string): Promise<boolean> {
    try {
      await tauriDb.deleteBoard(boardId);

      // Remove from boards list
      this.state.boards = this.state.boards.filter(b => b.id !== boardId);

      // If we deleted the current board, select another or create new default
      if (this.state.board?.id === boardId) {
        if (this.state.boards.length > 0) {
          await this.selectBoard(this.state.boards[0].id);
        } else {
          this.state.board = null;
          await this.createNewBoard('Default Board');
        }
      }

      this.notify();
      return true;
    } catch (error) {
      this.state.boardError = error instanceof Error ? error.message : 'Failed to delete board';
      this.notify();
      return false;
    }
  }

  // Delete current board (convenience method)
  async deleteCurrentBoard(): Promise<boolean> {
    if (!this.state.board) return false;
    return this.deleteBoard(this.state.board.id);
  }

  // Legacy method for backwards compatibility - now uses Tauri
  async loadOrCreateBoard(name: string = 'Default Board'): Promise<void> {
    this.state.boardLoading = true;
    this.state.boardError = null;
    this.notify();

    try {
      // Load all boards from local SQLite
      const boards = await tauriDb.listBoards();
      this.state.boards = boards;
      let board = boards.find((b: Board) => b.name === name);

      // Create if not found
      if (!board) {
        board = await tauriDb.createBoard(
          name,
          this.state.resources.dollars.max,
          this.state.resources.tokens.max
        );
        this.state.boards = [...this.state.boards, board];
      }

      this.state.board = board;
      this.syncBoardToState(board);
      this.state.boardLoading = false;
      this.notify();
    } catch (error) {
      this.state.boardLoading = false;
      this.state.boardError = error instanceof Error ? error.message : 'Failed to load board';
      this.notify();
    }
  }

  // Sync board data to local state
  // Maps database fields to local state using unified naming convention:
  //   max_dollars / max_tokens = budget limits
  //   total_dollars / total_tokens = persistent totals
  private syncBoardToState(board: Board): void {
    this.state.resources.dollars.max = board.max_dollars;
    this.state.resources.dollars.total = board.total_dollars;
    this.state.resources.tokens.max = board.max_tokens;
    this.state.resources.tokens.total = board.total_tokens;

    // Map board status to swarm status
    if (board.status === 'running') {
      this.state.swarmStatus = 'running';
    } else if (board.status === 'starting' || board.status === 'stopping') {
      this.state.swarmStatus = 'paused';
    } else {
      this.state.swarmStatus = 'stopped';
    }
  }

  // Start the current board (now uses local execution engine)
  async startBoard(): Promise<void> {
    // Use local execution engine instead of remote backend
    await this.startLocalExecution();
  }

  // Stop the current board (now uses local execution engine)
  async stopBoard(): Promise<void> {
    // Use local execution engine instead of remote backend
    await this.stopLocalExecution();
  }

  // Update board status in database
  async updateBoardStatus(status: BoardStatus): Promise<void> {
    if (!this.state.board) return;

    try {
      const updated = await tauriDb.updateBoard(this.state.board.id, { status });
      this.state.board = updated;
      this.syncBoardToState(updated);
      this.notify();
    } catch (error) {
      console.error('Failed to update board status:', error);
    }
  }

  // Get board status for UI
  getBoardStatus(): BoardStatus | null {
    return this.state.board?.status ?? null;
  }

  // Check if backend is connected
  isBoardConnected(): boolean {
    return this.state.board !== null;
  }

  // === Local Execution Engine Methods ===

  /**
   * Start the local execution engine (for offline/local mode)
   * This runs all hex actors in the browser
   */
  async startLocalExecution(): Promise<void> {
    console.log('[Store] startLocalExecution called');

    // Don't start if already running
    if (this.localRunner?.getStatus() === 'running') {
      console.warn('Local execution already running');
      return;
    }

    // Generate a local board ID if not connected to backend
    const boardId = this.state.board?.id ?? `local-${Date.now()}`;

    // Create the board runner
    this.localRunner = new BoardRunner({
      boardId,
      store: this,
      eventBus: globalEventBus,
      workQueue: globalWorkQueue,
    });

    // Subscribe to engine events to update UI state
    this.subscribeToEngineEvents();

    try {
      console.log('[Store] Setting status to starting');
      this.state.swarmStatus = 'paused'; // 'starting' equivalent
      if (this.state.board) {
        this.state.board = { ...this.state.board, status: 'starting' };
      }
      this.notify();

      console.log('[Store] Calling localRunner.start()');
      await this.localRunner.start();
      console.log('[Store] localRunner.start() completed');

      this.state.swarmStatus = 'running';
      if (this.state.board) {
        this.state.board = { ...this.state.board, status: 'running' };
      }
      console.log('[Store] Setting status to running, calling notify()');
      this.notify();
    } catch (error) {
      console.error('[Store] Error starting local execution:', error);
      this.state.swarmStatus = 'stopped';
      if (this.state.board) {
        this.state.board = { ...this.state.board, status: 'error' };
      }
      this.state.boardError = error instanceof Error ? error.message : 'Failed to start local execution';
      this.notify();
    }
  }

  /**
   * Stop the local execution engine
   */
  async stopLocalExecution(): Promise<void> {
    if (!this.localRunner) {
      console.warn('No local runner to stop');
      return;
    }

    try {
      this.state.swarmStatus = 'paused'; // 'stopping' equivalent
      if (this.state.board) {
        this.state.board = { ...this.state.board, status: 'stopping' };
      }
      this.notify();

      // Flush any pending entity saves before stopping
      await this.flushPendingEntitySaves();

      await this.localRunner.stop();

      // Cleanup event subscription
      if (this.engineEventCleanup) {
        this.engineEventCleanup();
        this.engineEventCleanup = null;
      }

      this.localRunner = null;
      this.state.swarmStatus = 'stopped';
      if (this.state.board) {
        this.state.board = { ...this.state.board, status: 'stopped' };
      }
      this.notify();
    } catch (error) {
      this.state.boardError = error instanceof Error ? error.message : 'Failed to stop local execution';
      if (this.state.board) {
        this.state.board = { ...this.state.board, status: 'error' };
      }
      this.notify();
    }
  }

  /**
   * Check if local execution engine is running
   */
  isLocalExecutionRunning(): boolean {
    return this.localRunner?.getStatus() === 'running';
  }

  /**
   * Get the local BoardRunner instance (for injecting work, testing, etc.)
   */
  getLocalRunner(): BoardRunner | null {
    return this.localRunner;
  }

  /**
   * Subscribe to engine events and update store state accordingly
   */
  private subscribeToEngineEvents(): void {
    // Clean up previous subscription
    if (this.engineEventCleanup) {
      this.engineEventCleanup();
    }

    this.engineEventCleanup = globalEventBus.onAll((event: EngineEvent) => {
      this.handleEngineEvent(event);
    });
  }

  /**
   * Handle engine events and update UI state.
   *
   * NOTE: Work stats (work.received, work.completed, task.completed) are NOT handled here.
   * Live work stats are now handled by React hooks (useWorkStatsFromEvents) that subscribe
   * directly to the EventBus. This keeps the EventBus as the source of truth for real-time
   * metrics, preventing duplication between the old class-based store and React hooks.
   */
  private handleEngineEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'hex.status':
        this.handleLocalHexStatus(event);
        break;
      // work.received and work.completed are handled by useWorkStatsFromEvents hook
      case 'hex.progress':
        this.notify();
        break;
      case 'work.flowing':
        // Could trigger animations here
        console.log('Work flowing:', event.data);
        break;
      case 'llm.response':
        // Track token usage from LLM responses
        this.handleLLMResponse(event);
        break;
      case 'board.started':
        console.log('Board started:', event.boardId);
        // Reset entity metrics (accumulated tokens/cost) on board start
        this.resetEntityMetrics();
        break;
      case 'board.stopped':
        console.log('Board stopped:', event.boardId);
        break;
      case 'task.claimed':
        this.notify();
        break;
      // task.completed is handled by useWorkStatsFromEvents hook
      case 'task.released':
        this.notify();
        break;
      case 'tasks.available':
        this.notify();
        break;
    }
  }

  /**
   * Reset entity run metrics when board starts.
   * Per-run metrics (runCost, runTokens, llmCallCount) reset on each board run.
   * Work stats are now handled by useWorkStatsFromEvents hook via EventBus.
   */
  private resetEntityMetrics(): void {
    // Reset per-run metrics for all entities (hex heights reset to 0)
    for (const entity of this.state.entities.values()) {
      if (entity.metrics) {
        entity.metrics.runTokens = 0;
        entity.metrics.runCost = 0;
        entity.metrics.llmCallCount = 0;
      }
    }

    this.notify();
  }

  /**
   * Handle LLM response events to update local state.
   * Note: Persistent totals are updated by BudgetTracker via the database.
   * This is only for local UI display during the current session.
   */
  private handleLLMResponse(event: EngineEvent): void {
    const usage = event.data.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
    const cost = event.data.cost as { totalCost?: number } | undefined;

    if (usage?.totalTokens) {
      this.state.resources.tokens.total += usage.totalTokens;
      console.log(`[Store] Token total updated: +${usage.totalTokens} (total: ${this.state.resources.tokens.total})`);
    }

    if (cost?.totalCost) {
      this.state.resources.dollars.total += cost.totalCost;
      console.log(`[Store] Cost total updated: +$${cost.totalCost.toFixed(6)} (total: $${this.state.resources.dollars.total.toFixed(6)})`);
    }

    this.notify();
  }

  /**
   * Handle hex status change from local engine
   */
  private handleLocalHexStatus(event: EngineEvent): void {
    const status = event.data?.status as string;

    // Find entity by hexId (which is the entity ID in our case)
    const entity = this.state.entities.get(event.hexId);
    if (entity) {
      // Map engine status to entity status
      if (status === 'active' || status === 'working') {
        entity.status = 'active';
      } else if (status === 'error') {
        entity.status = 'error';
      } else {
        entity.status = 'idle';
      }
      this.notify();
    }
  }

  /**
   * Inject a test work item into a tasklist tool hex (for testing/debugging)
   */
  injectTestWork(hexKey: string, payload: Record<string, unknown>): void {
    if (!this.localRunner) {
      console.warn('Local runner not started');
      return;
    }

    const hex = this.state.hexes.get(hexKey);
    if (!hex?.entityId) {
      console.warn('No entity at hex:', hexKey);
      return;
    }

    const entity = this.state.entities.get(hex.entityId);
    if (!entity || entity.category !== 'tool' || (entity as ToolEntity).toolType !== 'tasklist') {
      console.warn('Entity is not a tasklist tool:', entity?.category);
      return;
    }

    // Create work item and route it
    const workItem = globalWorkQueue.create({
      boardId: this.state.board?.id ?? 'local',
      sourceHexId: hex.entityId,
      currentHexId: hex.entityId,
      status: 'pending',
      payload,
    });

    // Route to adjacent hexes
    this.localRunner.routeWorkToAdjacent(hexKey, workItem);

    this.state.work.queued++;
    this.notify();
  }
}

