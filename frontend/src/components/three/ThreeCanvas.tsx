/**
 * ThreeCanvas Component
 * Wrapper for Three.js renderer with proper React lifecycle management
 *
 * Uses Zustand subscription pattern (like the old implementation) to ensure
 * the Three.js renderer is called on EVERY state change, not just when
 * React detects a change in the dependency array.
 */

import { useEffect, useRef, useCallback } from 'react';
import { Renderer3D } from '../../hex/renderer3d';
import { HexGrid } from '../../hex/grid';
import { useStore } from '../../store';
import type { Entity } from '../../store/types';

export function ThreeCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer3D | null>(null);
  const gridRef = useRef<HexGrid | null>(null);
  const isInitializedRef = useRef(false);

  // Get store actions directly from the store to avoid hook dependency issues
  const selectHex = useStore((state) => state.selectHex);
  const setIsPanning = useStore((state) => state.setIsPanning);
  const setIsConnecting = useStore((state) => state.setIsConnecting);
  const setConnectingFrom = useStore((state) => state.setConnectingFrom);
  const addHex = useStore((state) => state.addHex);

  // Store refs for actions so the adapter always has the latest
  const selectHexRef = useRef(selectHex);
  const setIsPanningRef = useRef(setIsPanning);
  const setIsConnectingRef = useRef(setIsConnecting);
  const setConnectingFromRef = useRef(setConnectingFrom);
  const addHexRef = useRef(addHex);

  // Update refs when actions change
  useEffect(() => {
    selectHexRef.current = selectHex;
    setIsPanningRef.current = setIsPanning;
    setIsConnectingRef.current = setIsConnecting;
    setConnectingFromRef.current = setConnectingFrom;
    addHexRef.current = addHex;
  }, [selectHex, setIsPanning, setIsConnecting, setConnectingFrom, addHex]);

  // Create store adapter - memoized to avoid recreating on every render
  const createStoreAdapter = useCallback(() => ({
    getState: () => {
      const state = useStore.getState();
      // Derive selectedEntity from the hex's entityId
      const selectedEntityId = state.selectedHexKey
        ? state.hexes.get(state.selectedHexKey)?.entityId ?? null
        : null;
      return {
        board: state.currentBoard,
        boards: state.boards,
        boardLoading: state.boardLoading,
        boardError: state.boardError,
        hexes: state.hexes,
        entities: state.entities,
        connections: state.connections,
        selectedHex: state.selectedHexKey,
        selectedEntity: selectedEntityId,
        isPanning: state.isPanning,
        isConnecting: state.isConnecting,
        connectingFrom: state.connectingFrom,
        resources: state.resources,
        // NOTE: work stats removed - now handled by useWorkStatsFromEvents hook via EventBus
        metrics: state.metrics,
        swarmStatus: state.swarmStatus,
        previewRange: state.previewRange,
      };
    },
    subscribe: (listener: () => void) => useStore.subscribe(listener),
    selectHex: (key: string | null) => selectHexRef.current(key),
    setIsPanning: (value: boolean) => setIsPanningRef.current(value),
    setIsConnecting: (value: boolean) => setIsConnectingRef.current(value),
    setConnectingFrom: (key: string | null) => setConnectingFromRef.current(key),
    updateEntity: (entityId: string, updates: Partial<Entity>) => useStore.getState().updateEntity(entityId, updates),
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
  }), []);

  // Initialize Three.js renderer ONCE and subscribe to store changes
  // Empty dependency array ensures this only runs once on mount
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('[ThreeCanvas] Initializing renderer...');

    // Create grid
    gridRef.current = new HexGrid(5); // radius of 5 hexes

    // Initialize hexes in store - only add hexes that don't already exist
    // This preserves hexes loaded from the database
    const existingHexes = useStore.getState().hexes;
    gridRef.current.getAllHexes().forEach(hex => {
      if (!existingHexes.has(hex.key)) {
        addHexRef.current(hex);
      }
    });

    // Create renderer
    const container = containerRef.current;
    const storeAdapter = createStoreAdapter();
    rendererRef.current = new Renderer3D(container, storeAdapter as any);

    // Helper function to build AppState and render
    const renderScene = () => {
      if (!rendererRef.current) {
        console.log('[ThreeCanvas] renderScene called but renderer is null');
        return;
      }

      const state = useStore.getState();

      // Derive selectedEntity from the hex
      const selectedEntityId = state.selectedHexKey
        ? state.hexes.get(state.selectedHexKey)?.entityId ?? null
        : null;

      // Count hexes with entities for debugging
      const hexesWithEntities = Array.from(state.hexes.values()).filter(h => h.entityId).length;

      const appState = {
        board: state.currentBoard,
        boards: state.boards,
        boardLoading: state.boardLoading,
        boardError: state.boardError,
        hexes: state.hexes,
        entities: state.entities,
        connections: state.connections,
        selectedHex: state.selectedHexKey,
        selectedEntity: selectedEntityId,
        isPanning: state.isPanning,
        isConnecting: state.isConnecting,
        connectingFrom: state.connectingFrom,
        resources: state.resources,
        // NOTE: work stats removed - now handled by useWorkStatsFromEvents hook via EventBus
        metrics: state.metrics,
        swarmStatus: state.swarmStatus,
        previewRange: state.previewRange,
      };

      console.log('[ThreeCanvas] Rendering - hexes:', state.hexes.size, 'entities:', state.entities.size, 'hexesWithEntities:', hexesWithEntities);
      rendererRef.current.render(appState as any);
    };

    // Initial render
    console.log('[ThreeCanvas] Calling initial renderScene...');
    renderScene();

    // Subscribe to ALL store changes - this is the key pattern from the old implementation
    // Every state change triggers a re-render of the Three.js scene
    console.log('[ThreeCanvas] Setting up store subscription...');
    const unsubscribe = useStore.subscribe(() => {
      console.log('[ThreeCanvas] Store subscription triggered!');
      renderScene();
    });

    console.log('[ThreeCanvas] Renderer initialized and subscribed to store');

    return () => {
      console.log('[ThreeCanvas] Cleaning up renderer...');
      unsubscribe();
      // Properly dispose of Three.js resources and remove canvas from DOM
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      rendererRef.current = null;
      isInitializedRef.current = false;
    };
  }, [createStoreAdapter]); // createStoreAdapter is memoized with useCallback

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full"
    />
  );
}

export default ThreeCanvas;

