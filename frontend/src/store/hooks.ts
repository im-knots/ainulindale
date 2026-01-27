/**
 * Zustand store hooks for React components
 * Provides typed selectors for common state access patterns
 */

import { useMemo } from 'react';
import { useStore } from './index';
import { useShallow } from 'zustand/react/shallow';
import { Entity, AgentEntity, ToolEntity, HexData, Board } from './types';

// Board hooks
export function useCurrentBoard(): Board | null {
  return useStore((state) => state.currentBoard);
}

export function useBoards(): Board[] {
  return useStore((state) => state.boards);
}

export function useBoardLoading(): boolean {
  return useStore((state) => state.boardLoading);
}

export function useBoardError(): string | null {
  return useStore((state) => state.boardError);
}

// Selection hooks
export function useSelectedHexKey(): string | null {
  return useStore((state) => state.selectedHexKey);
}

export function useSelectedEntityId(): string | null {
  // Derive from selected hex's entityId, not from separate state
  return useStore((state) => {
    if (!state.selectedHexKey) return null;
    const hex = state.hexes.get(state.selectedHexKey);
    return hex?.entityId ?? null;
  });
}

export function useSelectedEntity(): Entity | null {
  // Derive from selected hex's entityId, then look up in entities map
  // This ensures React re-renders when:
  // 1. selectedHexKey changes
  // 2. The selected hex's entityId changes (entity placed/removed)
  // 3. The entity itself changes
  return useStore((state) => {
    if (!state.selectedHexKey) return null;
    const hex = state.hexes.get(state.selectedHexKey);
    if (!hex?.entityId) return null;
    return state.entities.get(hex.entityId) ?? null;
  });
}

export function useSelectedHex(): HexData | null {
  return useStore((state) => {
    if (!state.selectedHexKey) return null;
    return state.hexes.get(state.selectedHexKey) ?? null;
  });
}

// Entity hooks
export function useEntity(entityId: string | null): Entity | null {
  return useStore((state) => {
    if (!entityId) return null;
    return state.entities.get(entityId) ?? null;
  });
}

export function useEntities(): Map<string, Entity> {
  return useStore((state) => state.entities);
}

export function useAgentEntities(): AgentEntity[] {
  return useStore((state) => {
    const agents: AgentEntity[] = [];
    for (const entity of state.entities.values()) {
      if (entity.category === 'agent') {
        agents.push(entity as AgentEntity);
      }
    }
    return agents;
  });
}

export function useToolEntities(): ToolEntity[] {
  return useStore((state) => {
    const tools: ToolEntity[] = [];
    for (const entity of state.entities.values()) {
      if (entity.category === 'tool') {
        tools.push(entity as ToolEntity);
      }
    }
    return tools;
  });
}

// Hex hooks
export function useHex(hexKey: string | null): HexData | null {
  return useStore((state) => {
    if (!hexKey) return null;
    return state.hexes.get(hexKey) ?? null;
  });
}

export function useHexes(): Map<string, HexData> {
  return useStore((state) => state.hexes);
}

// Resource hooks
export function useResources() {
  return useStore((state) => state.resources);
}

export function useDollars() {
  return useStore((state) => state.resources.dollars);
}

export function useTokens() {
  return useStore((state) => state.resources.tokens);
}

// Computed board metrics from all entities
// Computed board metrics from all entities
// Uses per-run metrics (runCost, runTokens) that reset each board run
// Uses useShallow to prevent infinite re-renders when returning computed objects
export function useBoardMetrics() {
  return useStore(
    useShallow((state) => {
      let totalCost = 0;
      let totalTokens = 0;
      let totalLlmCalls = 0;

      for (const entity of state.entities.values()) {
        if (entity.metrics) {
          totalCost += entity.metrics.runCost || 0;
          totalTokens += entity.metrics.runTokens || 0;
          totalLlmCalls += entity.metrics.llmCallCount || 0;
        }
      }

      return { totalCost, totalTokens, totalLlmCalls };
    })
  );
}

// NOTE: useWorkStats removed - now use useWorkStatsFromEvents hook from hooks/useWorkStatsFromEvents.ts
// Work stats are now handled via EventBus subscription, not Zustand store

// Swarm status hooks
export function useSwarmStatus() {
  return useStore((state) => state.swarmStatus);
}

// UI state hooks
export function useIsPanning() {
  return useStore((state) => state.isPanning);
}

export function useIsConnecting() {
  return useStore((state) => state.isConnecting);
}

export function usePreviewRange() {
  return useStore((state) => state.previewRange);
}

// Actions hook - returns all actions for components that need multiple
// Uses individual selectors to avoid creating new objects on every render
export function useStoreActions() {
  const setBoards = useStore((state) => state.setBoards);
  const setCurrentBoard = useStore((state) => state.setCurrentBoard);
  const setBoardLoading = useStore((state) => state.setBoardLoading);
  const setBoardError = useStore((state) => state.setBoardError);
  const addHex = useStore((state) => state.addHex);
  const selectHex = useStore((state) => state.selectHex);
  const addEntity = useStore((state) => state.addEntity);
  const updateEntity = useStore((state) => state.updateEntity);
  const removeEntity = useStore((state) => state.removeEntity);
  const setEntityStatus = useStore((state) => state.setEntityStatus);
  const addConnection = useStore((state) => state.addConnection);
  const removeConnection = useStore((state) => state.removeConnection);
  const setIsPanning = useStore((state) => state.setIsPanning);
  const setIsConnecting = useStore((state) => state.setIsConnecting);
  const setConnectingFrom = useStore((state) => state.setConnectingFrom);
  const setPreviewRange = useStore((state) => state.setPreviewRange);
  const updateResources = useStore((state) => state.updateResources);
  const addTotalDollars = useStore((state) => state.addTotalDollars);
  const addTotalTokens = useStore((state) => state.addTotalTokens);
  // NOTE: updateWorkStats removed - work stats now handled by useWorkStatsFromEvents hook via EventBus
  const setSwarmStatus = useStore((state) => state.setSwarmStatus);
  const reset = useStore((state) => state.reset);

  return useMemo(() => ({
    setBoards,
    setCurrentBoard,
    setBoardLoading,
    setBoardError,
    addHex,
    selectHex,
    addEntity,
    updateEntity,
    removeEntity,
    setEntityStatus,
    addConnection,
    removeConnection,
    setIsPanning,
    setIsConnecting,
    setConnectingFrom,
    setPreviewRange,
    updateResources,
    addTotalDollars,
    addTotalTokens,
    setSwarmStatus,
    reset,
  }), [
    setBoards, setCurrentBoard, setBoardLoading, setBoardError,
    addHex, selectHex, addEntity, updateEntity, removeEntity, setEntityStatus,
    addConnection, removeConnection, setIsPanning, setIsConnecting, setConnectingFrom,
    setPreviewRange, updateResources, addTotalDollars, addTotalTokens,
    setSwarmStatus, reset,
  ]);
}

