/**
 * BaseActor - Common functionality for all hex actors
 */

import { Entity, Store } from '../../state/store';
import { HexActor, WorkItem, EngineEvent } from '../types';
import { EventBus } from '../event-bus';
import { WorkQueue } from '../work-queue';
import type { BoardRunner } from '../board-runner';

export interface ActorConfig {
  hexId: string;
  hexKey: string;
  boardId: string;
  entity: Entity;
  eventBus: EventBus;
  workQueue: WorkQueue;
  boardRunner: BoardRunner;
  store: Store;
}

export abstract class BaseActor implements HexActor {
  protected config: ActorConfig;
  protected inbox: WorkItem[] = [];
  protected running = false;
  private isProcessing = false;
  // Track processed work item IDs to prevent duplicate processing
  private processedWorkIds: Set<string> = new Set();

  constructor(config: ActorConfig) {
    this.config = config;
  }

  get hexId(): string {
    return this.config.hexId;
  }

  get hexKey(): string {
    return this.config.hexKey;
  }

  /**
   * Start the actor - just sets running flag, no loop
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emitStatus('idle');
  }

  /**
   * Stop the actor
   */
  async stop(): Promise<void> {
    this.running = false;
    this.emitStatus('disabled');
  }

  /**
   * Check if the actor is busy (processing or has work in inbox)
   * Used by agents to avoid claiming new tasks when already working
   */
  protected isBusy(): boolean {
    return this.isProcessing || this.inbox.length > 0;
  }

  /**
   * Get work status for this actor (for UI stats)
   * Returns count of pending (inbox) and processing work items
   */
  getWorkStatus(): { pending: number; processing: number } {
    return {
      pending: this.inbox.length,
      processing: this.isProcessing ? 1 : 0,
    };
  }

  /**
   * Receive work for processing - triggers processing directly
   * Prevents duplicate work items from being processed
   */
  receiveWork(workItem: WorkItem): void {
    if (!this.running) return;

    // Check if we've already processed or have this work item
    if (this.processedWorkIds.has(workItem.id)) {
      console.log(`[Actor ${this.hexId}] Skipping duplicate work item: ${workItem.id}`);
      return;
    }

    // Check if already in inbox
    if (this.inbox.some(w => w.id === workItem.id)) {
      console.log(`[Actor ${this.hexId}] Work item already in inbox: ${workItem.id}`);
      return;
    }

    this.inbox.push(workItem);
    this.emitEvent('work.received', { workItemId: workItem.id });

    // Trigger processing if not already processing
    this.processNext();
  }

  /**
   * Process next work item in inbox (event-driven, no loop)
   */
  private async processNext(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing || !this.running) return;

    const workItem = this.inbox.shift();
    if (!workItem) return;

    // Mark as processed to prevent reprocessing
    this.processedWorkIds.add(workItem.id);

    // Limit size of processed set to prevent memory leak
    if (this.processedWorkIds.size > 1000) {
      const idsArray = Array.from(this.processedWorkIds);
      this.processedWorkIds = new Set(idsArray.slice(-500));
    }

    this.isProcessing = true;

    try {
      await this.processWorkItem(workItem);
    } catch (error) {
      console.error(`[Actor ${this.hexId}] Error processing work:`, error);
      this.emitEvent('error', { error: String(error), workItemId: workItem.id });
    } finally {
      this.isProcessing = false;
    }

    // Process next item if any (using setTimeout to avoid stack overflow)
    if (this.inbox.length > 0 && this.running) {
      setTimeout(() => this.processNext(), 0);
    }
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Process a single work item - override in subclasses
   */
  protected abstract processWorkItem(workItem: WorkItem): Promise<void>;

  /**
   * Emit an event
   */
  protected emitEvent(type: EngineEvent['type'], data: Record<string, unknown> = {}): void {
    this.config.eventBus.emit({
      type,
      hexId: this.hexId,
      boardId: this.config.boardId,
      data,
      timestamp: new Date(),
    });
  }

  /**
   * Emit status change
   */
  protected emitStatus(status: string): void {
    this.emitEvent('hex.status', { status });
  }

  /**
   * Emit progress update
   */
  protected emitProgress(iteration: number, workItemId: string): void {
    this.emitEvent('hex.progress', { iteration, workItemId });
  }

  /**
   * Route work to adjacent hexes
   */
  protected routeToAdjacent(workItem: WorkItem): void {
    this.config.boardRunner.routeWorkToAdjacent(this.hexKey, workItem);
  }

  /**
   * Get next work item from inbox
   */
  protected getNextWorkItem(): WorkItem | undefined {
    return this.inbox.shift();
  }

  /**
   * Sleep for a duration
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

