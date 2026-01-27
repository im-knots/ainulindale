/**
 * Board Execution Service
 * Manages the BoardRunner lifecycle and integrates with the Zustand store
 */

import { BoardRunner } from './board-runner';
import { eventBus } from './event-bus';
import { workQueue } from './work-queue';
import { useStore } from '../store';
import { EngineEvent } from './types';

// Module-level state for the board runner
let boardRunner: BoardRunner | null = null;
let engineEventCleanup: (() => void) | null = null;

/**
 * Create a store adapter that matches the old Store interface expected by BoardRunner
 */
function createStoreAdapter() {
  return {
    getState: () => {
      const state = useStore.getState();
      return {
        board: state.currentBoard,
        hexes: state.hexes,
        entities: state.entities,
        connections: state.connections,
        selectedHex: state.selectedHexKey,
        selectedEntity: state.selectedEntityId,
        resources: state.resources,
        // NOTE: work stats removed - now handled by useWorkStatsFromEvents hook via EventBus
        swarmStatus: state.swarmStatus,
      };
    },
    subscribe: (listener: () => void) => useStore.subscribe(listener),
    setEntityStatus: (entityId: string, status: string) => {
      useStore.getState().setEntityStatus(entityId, status as any);
    },
    // NOTE: updateWorkStats removed - work stats now handled by useWorkStatsFromEvents hook via EventBus
    addTotalDollars: (amount: number) => {
      useStore.getState().addTotalDollars(amount);
    },
    addTotalTokens: (amount: number) => {
      useStore.getState().addTotalTokens(amount);
    },
    updateEntity: (entityId: string, updates: Record<string, unknown>) => {
      useStore.getState().updateEntity(entityId, updates as any);
    },
    addEntityCost: (entityId: string, cost: number, tokens: number) => {
      const state = useStore.getState();
      const entity = state.entities.get(entityId);
      if (!entity) return;

      // Initialize metrics if not present
      const currentMetrics = entity.metrics || {
        throughput: 0,
        errorRate: 0,
        latencyMs: 0,
        queueDepth: 0,
        utilization: 0,
        llmCallCount: 0,
        runCost: 0,
        runTokens: 0,
      };

      // Accumulate per-run cost/tokens and increment LLM call count
      const updatedMetrics = {
        ...currentMetrics,
        llmCallCount: (currentMetrics.llmCallCount || 0) + 1,
        runCost: (currentMetrics.runCost || 0) + cost,
        runTokens: (currentMetrics.runTokens || 0) + tokens,
      };

      state.updateEntity(entityId, { metrics: updatedMetrics });
    },
  };
}

/**
 * Handle engine events and update UI state
 */
/**
 * Handle engine events that require persistent state updates.
 *
 * NOTE: Work stats (work.received, work.completed) are NOT handled here.
 * Live work stats are handled by React hooks (useWorkStatsFromEvents) that
 * subscribe directly to the EventBus. This keeps the EventBus as the source
 * of truth for real-time metrics, while Zustand only manages persistent state.
 */
function handleEngineEvent(event: EngineEvent): void {
  // Log all events for debugging
  if (event.type === 'budget.exceeded') {
    console.log('[BoardExecution] handleEngineEvent received budget.exceeded:', event);
  }

  const store = useStore.getState();

  switch (event.type) {
    case 'hex.status': {
      // Update entity status in persistent store (for 3D renderer updates)
      // The hexId in the event IS the entity ID (actors emit events with their entity ID as hexId)
      const entityId = event.hexId;
      const status = event.data?.status as string | undefined;
      if (entityId && status) {
        store.setEntityStatus(entityId, status as any);
      }
      break;
    }
    case 'board.started': {
      // Reset per-run entity metrics when board starts
      console.log('[BoardExecution] Board started - resetting run metrics');
      resetEntityRunMetrics();
      break;
    }
    case 'budget.updated': {
      // Update currentBoard with new persistent totals from database
      // This keeps the top bar in sync with real-time spending
      const totalDollars = event.data?.totalDollars as number | undefined;
      const totalTokens = event.data?.totalTokens as number | undefined;
      if (totalDollars !== undefined && totalTokens !== undefined) {
        updateBoardTotals(totalDollars, totalTokens);
      }
      break;
    }
    case 'budget.exceeded': {
      // Stop the board when budget is exceeded
      console.warn('[BoardExecution] Received budget.exceeded event - stopping board immediately', event.data);
      stopBoardExecution().catch(err => {
        console.error('[BoardExecution] Error stopping board after budget exceeded:', err);
      });
      break;
    }
    // Work stats events are handled by useWorkStatsFromEvents hook
    // No action needed here - EventBus is the source of truth for live metrics
  }
}

/**
 * Reset per-run metrics for all entities.
 * Called when board starts - runCost, runTokens, llmCallCount reset to 0.
 * This resets hex heights back to base height.
 */
function resetEntityRunMetrics(): void {
  const state = useStore.getState();
  const entities = state.entities;

  for (const [entityId, entity] of entities) {
    if (entity.metrics) {
      const resetMetrics = {
        ...entity.metrics,
        runCost: 0,
        runTokens: 0,
        llmCallCount: 0,
      };
      state.updateEntity(entityId, { metrics: resetMetrics });
    }
  }
}

/**
 * Update the currentBoard's persistent totals from database.
 * Called when budget.updated event is received from BudgetTracker.
 * This keeps the top bar in sync with real-time spending.
 */
function updateBoardTotals(totalDollars: number, totalTokens: number): void {
  const state = useStore.getState();
  const currentBoard = state.currentBoard;

  if (!currentBoard) return;

  // Update the currentBoard with new totals
  state.setCurrentBoard({
    ...currentBoard,
    total_dollars: totalDollars,
    total_tokens: totalTokens,
  });
}

/**
 * Start board execution
 */
export async function startBoardExecution(): Promise<void> {
  console.log('[BoardExecution] Starting board execution...');
  
  const state = useStore.getState();
  
  // Don't start if already running
  if (boardRunner?.getStatus() === 'running') {
    console.warn('[BoardExecution] Board is already running');
    return;
  }
  
  // Need a board to run
  if (!state.currentBoard) {
    console.error('[BoardExecution] No board selected');
    state.setBoardError('No board selected');
    return;
  }
  
  const boardId = state.currentBoard.id;
  
  // Create the board runner with store adapter
  const storeAdapter = createStoreAdapter();
  boardRunner = new BoardRunner({
    boardId,
    store: storeAdapter as any,
    eventBus,
    workQueue,
  });
  
  // Subscribe to engine events
  engineEventCleanup = eventBus.onAll(handleEngineEvent);
  
  try {
    state.setSwarmStatus('paused'); // 'starting' equivalent
    
    await boardRunner.start();
    
    state.setSwarmStatus('running');
    console.log('[BoardExecution] Board started successfully');
  } catch (error) {
    console.error('[BoardExecution] Error starting board:', error);
    state.setSwarmStatus('stopped');
    state.setBoardError(error instanceof Error ? error.message : 'Failed to start board');
  }
}

/**
 * Stop board execution
 */
export async function stopBoardExecution(): Promise<void> {
  console.log('[BoardExecution] Stopping board execution...');
  
  const state = useStore.getState();
  
  if (!boardRunner) {
    console.warn('[BoardExecution] No board runner to stop');
    return;
  }
  
  try {
    state.setSwarmStatus('paused'); // 'stopping' equivalent
    
    await boardRunner.stop();
    
    // Cleanup
    if (engineEventCleanup) {
      engineEventCleanup();
      engineEventCleanup = null;
    }
    boardRunner = null;
    
    state.setSwarmStatus('stopped');
    console.log('[BoardExecution] Board stopped successfully');
  } catch (error) {
    console.error('[BoardExecution] Error stopping board:', error);
    state.setBoardError(error instanceof Error ? error.message : 'Failed to stop board');
  }
}

/**
 * Check if board is currently running
 */
export function isBoardRunning(): boolean {
  return boardRunner?.getStatus() === 'running';
}

/**
 * Get the current board runner (for testing/debugging)
 */
export function getBoardRunner(): BoardRunner | null {
  return boardRunner;
}

