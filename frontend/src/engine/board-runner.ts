/**
 * BoardRunner - Orchestrates local execution of a board
 *
 * Manages the lifecycle of hex actors, routes work items,
 * and computes adjacency relationships.
 */

import { Store, Entity, AppState } from '../state/store';
import { getAllNeighbors, hexKey as toHexKey } from '../hex/math';
import { HexActor, WorkItem, EngineEvent } from './types';
import { eventBus, EventBus } from './event-bus';
import { workQueue, WorkQueue } from './work-queue';
import { AgentActor } from './actors/agent-actor';
import { ToolActor } from './actors/tool-actor';
import { setToolActorGetter, clearToolActorGetter } from './tools/plugins';
import { changeTracker, fileReservationManager, filesystemContextManager } from './context';
import { IndexerService } from './indexer-service';
import { BudgetTracker, BudgetLimits } from './budget-tracker';

export type BoardRunnerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface BoardRunnerConfig {
  boardId: string;
  store: Store;
  eventBus?: EventBus;
  workQueue?: WorkQueue;
}

export class BoardRunner {
  private boardId: string;
  private store: Store;
  private actors: Map<string, HexActor> = new Map();
  private status: BoardRunnerStatus = 'stopped';
  private eventBus: EventBus;
  private workQueue: WorkQueue;
  private unsubscribeStore?: () => void;
  private lastEntityConfigs: Map<string, string> = new Map(); // entityId -> JSON.stringify(config)
  private indexerService: IndexerService;
  private budgetTracker: BudgetTracker | null = null;

  constructor(config: BoardRunnerConfig) {
    this.boardId = config.boardId;
    this.store = config.store;
    this.eventBus = config.eventBus ?? eventBus;
    this.workQueue = config.workQueue ?? workQueue;
    this.indexerService = new IndexerService(this.eventBus, this.store);
  }

  /**
   * Start the board - creates actors for all hexes and begins execution
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      console.warn('Board is already running');
      return;
    }

    this.status = 'starting';
    this.emitBoardEvent('board.starting');

    // Initialize context management - clear any stale state and subscribe to events
    fileReservationManager.clearAll();
    changeTracker.clearAll();
    changeTracker.subscribe(this.eventBus);
    filesystemContextManager.clearAll();
    filesystemContextManager.subscribe(this.eventBus);

    // Set up tool actor getter for tasklist tool provider
    setToolActorGetter((hexKey) => this.getActor(hexKey));

    try {
      // Get all hexes from the store
      const state = this.store.getState();
      const hexes = Array.from(state.hexes.values());

      // Initialize budget tracker with limits and persistent totals from the board
      // Naming convention: max = limits, total = persistent totals from database
      const budgetLimits: BudgetLimits = {
        maxDollars: state.resources.dollars.max,
        maxTokens: state.resources.tokens.max,
      };
      // Get initial usage from the board's persistent totals
      const initialUsage = {
        dollarsSpent: state.resources.dollars.total,
        tokensUsed: state.resources.tokens.total,
      };
      this.budgetTracker = new BudgetTracker(this.eventBus, this.boardId, budgetLimits, initialUsage);
      this.budgetTracker.start();

      // Create actors for each hex that has an entity
      for (const hex of hexes) {
        if (hex.entityId) {
          const entity = state.entities.get(hex.entityId);
          if (entity) {
            const actor = this.createActor(hex.key, entity);
            if (actor) {
              this.actors.set(hex.key, actor);
              // Store initial config for change detection (tools have config, agents have other props)
              const entitySnapshot = entity.category === 'tool'
                ? JSON.stringify(entity.config)
                : JSON.stringify({ systemPrompt: entity.systemPrompt, model: entity.model });
              this.lastEntityConfigs.set(entity.id, entitySnapshot);
            }
          }
        }
      }

      // Start all actors
      const startPromises = Array.from(this.actors.values()).map(actor => actor.start());
      await Promise.all(startPromises);

      // Start indexer service (indexes all filesystem hexes for RAG-based codebase search)
      await this.indexerService.start();

      // Subscribe to store changes for dynamic updates
      this.unsubscribeStore = this.store.subscribe(() => {
        this.handleStoreChange();
      });

      this.status = 'running';
      this.emitBoardEvent('board.started');
    } catch (error) {
      this.status = 'error';
      this.emitBoardEvent('board.error', { error: String(error) });
      throw error;
    }
  }

  /**
   * Stop the board - gracefully shuts down all actors
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      console.warn('Board is not running');
      return;
    }

    this.status = 'stopping';
    this.emitBoardEvent('board.stopping');

    // Clear tool actor getter
    clearToolActorGetter();

    // Stop indexer service
    this.indexerService.stop();

    // Stop budget tracker
    if (this.budgetTracker) {
      this.budgetTracker.stop();
      this.budgetTracker = null;
    }

    // Unsubscribe from store
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = undefined;
    }

    // Stop all actors
    const stopPromises = Array.from(this.actors.values()).map(actor => actor.stop());
    await Promise.all(stopPromises);

    this.actors.clear();

    // Clean up context management
    changeTracker.unsubscribeAll();
    changeTracker.clearAll();
    fileReservationManager.clearAll();
    filesystemContextManager.unsubscribeAll();
    filesystemContextManager.clearAll();

    this.status = 'stopped';
    this.emitBoardEvent('board.stopped');
  }

  /**
   * Get current status
   */
  getStatus(): BoardRunnerStatus {
    return this.status;
  }

  /**
   * Get actor for a hex
   */
  getActor(hexKey: string): HexActor | undefined {
    return this.actors.get(hexKey);
  }

  /**
   * Route work to adjacent hexes
   * - Completed work only goes to tool hexes (tasklists)
   * - Pending/new work can go to agents
   */
  routeWorkToAdjacent(sourceHexKey: string, workItem: WorkItem): void {
    const state = this.store.getState();

    // Get adjacent entities with their hex keys
    const adjacentWithKeys = this.getAdjacentEntitiesWithKeys(sourceHexKey, state);

    for (const { entity, hexKey } of adjacentWithKeys) {
      // Skip routing completed work to agents - only route to tools (tasklists)
      // This prevents infinite loops when adjacent agents receive each other's completed work
      if (workItem.status === 'completed' && entity.category === 'agent') {
        continue;
      }

      const actor = this.actors.get(hexKey);
      if (actor) {
        const routedItem = { ...workItem, currentHexId: entity.id };
        actor.receiveWork(routedItem);
        this.emitWorkFlowing(sourceHexKey, hexKey, workItem.id);
      }
    }
  }

  /**
   * Get adjacent entities with their hex keys
   * This wraps getAdjacentEntities to also include the hex key for each entity
   */
  private getAdjacentEntitiesWithKeys(targetHexKey: string, state: AppState): { entity: Entity; hexKey: string }[] {
    const result: { entity: Entity; hexKey: string }[] = [];

    // Parse hex key to get coordinates
    const [q, r] = targetHexKey.split(',').map(Number);
    const neighbors = getAllNeighbors({ q, r });

    for (const neighborCoord of neighbors) {
      const neighborKey = toHexKey(neighborCoord);
      const hex = state.hexes.get(neighborKey);

      if (hex?.entityId) {
        const entity = state.entities.get(hex.entityId);
        if (entity) {
          result.push({ entity, hexKey: neighborKey });
        }
      }
    }

    return result;
  }

  /**
   * Create an actor for a hex entity
   */
  private createActor(hexKey: string, entity: Entity): HexActor | null {
    const config = {
      hexId: entity.id,
      hexKey,
      boardId: this.boardId,
      entity,
      eventBus: this.eventBus,
      workQueue: this.workQueue,
      boardRunner: this,
      store: this.store,
    };

    switch (entity.category) {
      case 'agent':
        return new AgentActor(config);
      case 'tool':
        return new ToolActor(config);
      default:
        return null;
    }
  }

  /**
   * Handle store changes - detect entity config changes and notify actors
   */
  private handleStoreChange(): void {
    if (this.status !== 'running') return;

    const state = this.store.getState();

    // Check each tracked entity for config changes
    for (const [entityId, lastConfigStr] of this.lastEntityConfigs) {
      const entity = state.entities.get(entityId);
      if (!entity) continue;

      // Get current snapshot
      const currentSnapshot = entity.category === 'tool'
        ? JSON.stringify(entity.config)
        : JSON.stringify({ systemPrompt: entity.systemPrompt, model: entity.model });

      // Detect if config changed
      if (currentSnapshot !== lastConfigStr) {
        // Update stored config
        this.lastEntityConfigs.set(entityId, currentSnapshot);

        // Find the hex key for this entity
        const hexKey = this.findHexKeyForEntity(entityId, state);
        if (!hexKey) continue;

        // Emit entity.updated event
        this.eventBus.emit({
          type: 'entity.updated',
          hexId: entityId,
          boardId: this.boardId,
          data: {
            entityId,
            hexKey,
            category: entity.category,
            changes: entity.category === 'tool' ? entity.config : {},
          },
          timestamp: new Date(),
        });

        console.log(`[BoardRunner] Entity ${entity.name} updated, emitting entity.updated`);
      }
    }
  }

  /**
   * Find the hex key for a given entity ID
   */
  private findHexKeyForEntity(entityId: string, state: AppState): string | undefined {
    for (const [key, hex] of state.hexes) {
      if (hex.entityId === entityId) {
        return key;
      }
    }
    return undefined;
  }

  /**
   * Emit a board-level event
   */
  private emitBoardEvent(type: string, data: Record<string, unknown> = {}): void {
    this.eventBus.emit({
      type: type as EngineEvent['type'],
      hexId: '',
      boardId: this.boardId,
      data,
      timestamp: new Date(),
    });
  }

  /**
   * Emit work flowing event (for visualization)
   * Uses entity UUIDs for hexId (not hex coordinate keys)
   */
  private emitWorkFlowing(fromHexKey: string, toHexKey: string, workItemId: string): void {
    // Convert hex keys to entity IDs
    const state = this.store.getState();
    const fromHex = state.hexes.get(fromHexKey);
    const fromEntityId = fromHex?.entityId || fromHexKey;

    this.eventBus.emit({
      type: 'work.flowing',
      hexId: fromEntityId,  // Entity UUID, not hex key
      boardId: this.boardId,
      data: { from: fromHexKey, to: toHexKey, workItemId },
      timestamp: new Date(),
    });
  }
}

