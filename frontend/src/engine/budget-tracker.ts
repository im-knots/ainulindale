/**
 * Budget Tracker
 * Monitors dollar and token usage against configured budgets
 * Emits budget.exceeded event when limits are reached
 *
 * Uses persistent totals from SQLite database - all usage is atomically
 * added to the database and the returned totals are used for budget checks.
 */

import { EventBus } from './event-bus';
import { EngineEvent } from './types';
import * as tauriDb from '../services/tauriDatabase';

export interface BudgetLimits {
  maxDollars: number;
  maxTokens: number;
}

export interface BudgetUsage {
  dollarsSpent: number;
  tokensUsed: number;
}

export class BudgetTracker {
  private eventBus: EventBus;
  private boardId: string;
  private limits: BudgetLimits;
  // Persistent totals from database - the source of truth for budget checks
  private persistentTotals: BudgetUsage;
  private exceeded: boolean = false;
  private llmEventCleanup: (() => void) | null = null;
  private limitsEventCleanup: (() => void) | null = null;

  constructor(
    eventBus: EventBus,
    boardId: string,
    limits: BudgetLimits,
    initialUsage?: BudgetUsage
  ) {
    this.eventBus = eventBus;
    this.boardId = boardId;
    this.limits = limits;
    // Initialize with current persistent totals from the board
    this.persistentTotals = initialUsage ?? {
      dollarsSpent: 0,
      tokensUsed: 0,
    };
  }

  /**
   * Start tracking budget
   */
  start(): void {
    console.log('[BudgetTracker] Starting budget tracking', {
      maxDollars: this.limits.maxDollars,
      maxTokens: this.limits.maxTokens,
    });

    // Subscribe to LLM response events to track usage
    this.llmEventCleanup = this.eventBus.on('llm.response', (event: EngineEvent) => {
      this.handleLLMResponse(event);
    });

    // Subscribe to budget limits updates (when user changes budget during a run)
    this.limitsEventCleanup = this.eventBus.on('budget.limits.updated', (event: EngineEvent) => {
      // Only handle events for this board
      if (event.boardId !== this.boardId) return;

      const maxDollars = event.data?.maxDollars as number | undefined;
      const maxTokens = event.data?.maxTokens as number | undefined;

      if (maxDollars !== undefined && maxTokens !== undefined) {
        this.updateLimits({ maxDollars, maxTokens });
        // Reset exceeded flag if new limits are higher than current usage
        if (this.exceeded) {
          const dollarOk = maxDollars === 0 || this.persistentTotals.dollarsSpent <= maxDollars;
          const tokenOk = maxTokens === 0 || this.persistentTotals.tokensUsed <= maxTokens;
          if (dollarOk && tokenOk) {
            this.exceeded = false;
            console.log('[BudgetTracker] Budget limits increased - resetting exceeded flag');
          }
        }
      }
    });

    // Reset exceeded flag
    this.exceeded = false;
  }

  /**
   * Stop tracking budget
   */
  stop(): void {
    if (this.llmEventCleanup) {
      this.llmEventCleanup();
      this.llmEventCleanup = null;
    }
    if (this.limitsEventCleanup) {
      this.limitsEventCleanup();
      this.limitsEventCleanup = null;
    }
  }

  /**
   * Reset local exceeded flag (persistent totals are NOT reset here - use resetBoardUsage for that)
   */
  reset(): void {
    this.exceeded = false;
  }

  /**
   * Update budget limits
   */
  updateLimits(limits: BudgetLimits): void {
    this.limits = limits;
    console.log('[BudgetTracker] Budget limits updated', limits);
  }

  /**
   * Get current usage (persistent totals from database)
   */
  getUsage(): BudgetUsage {
    return { ...this.persistentTotals };
  }

  /**
   * Get current limits
   */
  getLimits(): BudgetLimits {
    return { ...this.limits };
  }

  /**
   * Check if budget has been exceeded
   */
  isExceeded(): boolean {
    return this.exceeded;
  }

  /**
   * Handle LLM response event and track usage
   * Atomically updates persistent totals in database and checks budget
   */
  private handleLLMResponse(event: EngineEvent): void {
    const usage = event.data.usage as { totalTokens?: number } | undefined;
    const cost = event.data.cost as { totalCost?: number } | undefined;

    if (!usage && !cost) return;

    const deltaTokens = usage?.totalTokens ?? 0;
    const deltaDollars = cost?.totalCost ?? 0;

    if (deltaTokens === 0 && deltaDollars === 0) return;

    // Atomically add to persistent totals in database
    // The database returns the new totals after the increment
    tauriDb.addBoardUsage(this.boardId, deltaDollars, deltaTokens)
      .then(([newDollars, newTokens]) => {
        // Update local copy of persistent totals
        this.persistentTotals.dollarsSpent = newDollars;
        this.persistentTotals.tokensUsed = newTokens;

        console.log(`[BudgetTracker] Persistent totals updated: $${newDollars.toFixed(4)} / $${this.limits.maxDollars.toFixed(2)}, ${newTokens} / ${this.limits.maxTokens} tokens`);

        // Emit budget.updated event so UI can update in real-time
        this.eventBus.emit({
          type: 'budget.updated',
          hexId: '',
          boardId: this.boardId,
          data: {
            totalDollars: newDollars,
            totalTokens: newTokens,
          },
          timestamp: new Date(),
        });

        // Check if budget exceeded (only emit once)
        // A limit of 0 means unlimited - don't check that resource
        if (!this.exceeded) {
          const dollarExceeded = this.limits.maxDollars > 0 && newDollars > this.limits.maxDollars;
          const tokenExceeded = this.limits.maxTokens > 0 && newTokens > this.limits.maxTokens;

          if (dollarExceeded || tokenExceeded) {
            this.exceeded = true;

            console.warn('[BudgetTracker] BUDGET EXCEEDED - Emitting budget.exceeded event', {
              dollarsSpent: newDollars,
              maxDollars: this.limits.maxDollars,
              tokensUsed: newTokens,
              maxTokens: this.limits.maxTokens,
              dollarExceeded,
              tokenExceeded,
            });

            // Emit budget exceeded event
            this.eventBus.emit({
              type: 'budget.exceeded',
              hexId: '',
              boardId: this.boardId,
              data: {
                dollarsSpent: newDollars,
                tokensUsed: newTokens,
                maxDollars: this.limits.maxDollars,
                maxTokens: this.limits.maxTokens,
                dollarExceeded,
                tokenExceeded,
              },
              timestamp: new Date(),
            });
          }
        }
      })
      .catch((err) => {
        console.error('[BudgetTracker] Failed to update persistent totals:', err);
        // Fall back to local tracking if database fails
        this.persistentTotals.tokensUsed += deltaTokens;
        this.persistentTotals.dollarsSpent += deltaDollars;
      });
  }
}

