/**
 * Zustand Store for Ainulindale
 * Replaces the class-based Store with a modern React-friendly state manager
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  Board,
  Entity,
  AgentEntity,
  ToolEntity,
  Connection,
  Resources,
  Metrics,
  HexData,
} from './types';

// Store state interface
export interface StoreState {
  // Board management
  boards: Board[];
  currentBoard: Board | null;
  boardLoading: boolean;
  boardError: string | null;

  // Grid state
  hexes: Map<string, HexData>;
  entities: Map<string, Entity>;
  connections: Connection[];

  // Selection
  selectedHexKey: string | null;
  selectedEntityId: string | null;

  // UI interaction
  isPanning: boolean;
  isConnecting: boolean;
  connectingFrom: string | null;
  previewRange: number | null;

  // Resources & metrics (persistent state only)
  // NOTE: Live work stats are handled by useWorkStatsFromEvents hook via EventBus
  resources: Resources;
  metrics: Metrics;

  // Swarm status
  swarmStatus: 'stopped' | 'running' | 'paused';
}

// Store actions interface
export interface StoreActions {
  // Board actions
  setBoards: (boards: Board[]) => void;
  setCurrentBoard: (board: Board | null) => void;
  setBoardLoading: (loading: boolean) => void;
  setBoardError: (error: string | null) => void;
  // Load board state atomically (hexes, entities, connections)
  loadBoardState: (hexes: Map<string, HexData>, entities: Map<string, Entity>, connections: Connection[]) => void;

  // Hex actions
  addHex: (hex: HexData) => void;
  selectHex: (key: string | null) => void;

  // Entity actions
  addEntity: (entity: Entity, hexKey: string) => void;
  updateEntity: (entityId: string, updates: Partial<Entity>) => void;
  removeEntity: (entityId: string) => void;
  setEntityStatus: (entityId: string, status: Entity['status']) => void;

  // Connection actions
  addConnection: (connection: Connection) => void;
  removeConnection: (connectionId: string) => void;

  // UI actions
  setIsPanning: (isPanning: boolean) => void;
  setIsConnecting: (isConnecting: boolean) => void;
  setConnectingFrom: (hexKey: string | null) => void;
  setPreviewRange: (range: number | null) => void;

  // Resource actions
  updateResources: (resources: Partial<Resources>) => void;
  addTotalDollars: (amount: number) => void;
  addTotalTokens: (amount: number) => void;

  // Swarm actions
  setSwarmStatus: (status: 'stopped' | 'running' | 'paused') => void;

  // Reset
  reset: () => void;
}

// Initial state
const initialState: StoreState = {
  boards: [],
  currentBoard: null,
  boardLoading: false,
  boardError: null,
  hexes: new Map(),
  entities: new Map(),
  connections: [],
  selectedHexKey: null,
  selectedEntityId: null,
  isPanning: false,
  isConnecting: false,
  connectingFrom: null,
  previewRange: null,
  resources: {
    dollars: { max: 0, total: 0, projected: 0, rate: 0 },
    tokens: { max: 10_000_000, total: 0, projected: 0, rate: 0 },
  },
  // NOTE: work stats removed - now handled by useWorkStatsFromEvents hook via EventBus
  metrics: {
    costOverTime: [],
    throughputOverTime: [],
    queueDepthOverTime: [],
  },
  swarmStatus: 'stopped',
};

// Create the store
export const useStore = create<StoreState & StoreActions>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    // Board actions
    setBoards: (boards) => set({ boards }),
    setCurrentBoard: (board) => set({ currentBoard: board }),
    setBoardLoading: (loading) => set({ boardLoading: loading }),
    setBoardError: (error) => set({ boardError: error }),

    // Load board state atomically - clears selection and loads new hexes/entities/connections
    loadBoardState: (hexes, entities, connections) => set({
      hexes,
      entities,
      connections,
      selectedHexKey: null,
      selectedEntityId: null,
    }),

    // Hex actions
    addHex: (hex) => set((state) => {
      const newHexes = new Map(state.hexes);
      newHexes.set(hex.key, hex);
      return { hexes: newHexes };
    }),

    selectHex: (key) => set((state) => {
      console.log('[Store.selectHex] Selecting hex:', key);
      if (key === null) {
        return { selectedHexKey: null, selectedEntityId: null };
      }
      const hex = state.hexes.get(key);
      console.log('[Store.selectHex] Hex found:', !!hex, 'entityId:', hex?.entityId);
      return {
        selectedHexKey: key,
        selectedEntityId: hex?.entityId ?? null,
      };
    }),

    // Entity actions
    addEntity: (entity, hexKey) => set((state) => {
      console.log('[Store.addEntity] Adding entity:', entity.name, 'id:', entity.id, 'to hex:', hexKey);
      const newEntities = new Map(state.entities);
      newEntities.set(entity.id, entity);
      const newHexes = new Map(state.hexes);
      const hex = newHexes.get(hexKey);
      if (hex) {
        console.log('[Store.addEntity] Found hex, setting entityId:', entity.id);
        newHexes.set(hexKey, { ...hex, entityId: entity.id });
      } else {
        console.warn('[Store.addEntity] Hex not found:', hexKey);
      }
      console.log('[Store.addEntity] New state - entities:', newEntities.size, 'hexes with entityId:', Array.from(newHexes.values()).filter(h => h.entityId).length);
      // Note: We don't update selectedEntityId here - the useSelectedEntity hook
      // derives it from the hex's entityId, so React will re-render automatically
      return { entities: newEntities, hexes: newHexes };
    }),

    updateEntity: (entityId, updates) => set((state) => {
      const entity = state.entities.get(entityId);
      if (!entity) {
        console.warn('[Store.updateEntity] Entity not found:', entityId);
        return state;
      }
      console.log('[Store.updateEntity] Updating entity:', entityId, 'with updates:', Object.keys(updates));
      const newEntities = new Map(state.entities);
      const updatedEntity = { ...entity, ...updates } as Entity;
      newEntities.set(entityId, updatedEntity);
      console.log('[Store.updateEntity] New entity config:', (updatedEntity as any).config?.tasks);
      return { entities: newEntities };
    }),

    removeEntity: (entityId) => set((state) => {
      console.log('[Store.removeEntity] Removing entity:', entityId);
      const newEntities = new Map(state.entities);
      newEntities.delete(entityId);
      // Also remove from hex
      const newHexes = new Map(state.hexes);
      for (const [key, hex] of newHexes) {
        if (hex.entityId === entityId) {
          console.log('[Store.removeEntity] Clearing entityId from hex:', key);
          newHexes.set(key, { ...hex, entityId: undefined });
        }
      }
      console.log('[Store.removeEntity] New state - entities:', newEntities.size, 'hexes with entityId:', Array.from(newHexes.values()).filter(h => h.entityId).length);

      // If the removed entity was selected, clear selectedEntityId
      // This ensures the Panel switches back to EntitySelector
      const newSelectedEntityId = state.selectedEntityId === entityId ? null : state.selectedEntityId;
      console.log('[Store.removeEntity] selectedEntityId was:', state.selectedEntityId, 'now:', newSelectedEntityId);

      return { entities: newEntities, hexes: newHexes, selectedEntityId: newSelectedEntityId };
    }),

    setEntityStatus: (entityId, status) => set((state) => {
      const entity = state.entities.get(entityId);
      if (!entity) return state;
      const newEntities = new Map(state.entities);
      newEntities.set(entityId, { ...entity, status });
      return { entities: newEntities };
    }),

    // Connection actions
    addConnection: (connection) => set((state) => ({
      connections: [...state.connections, connection],
    })),

    removeConnection: (connectionId) => set((state) => ({
      connections: state.connections.filter((c) => c.id !== connectionId),
    })),

    // UI actions
    setIsPanning: (isPanning) => set({ isPanning }),
    setIsConnecting: (isConnecting) => set({ isConnecting }),
    setConnectingFrom: (hexKey) => set({ connectingFrom: hexKey }),
    setPreviewRange: (range) => set({ previewRange: range }),

    // Resource actions
    updateResources: (resources) => set((state) => ({
      resources: {
        dollars: { ...state.resources.dollars, ...resources.dollars },
        tokens: { ...state.resources.tokens, ...resources.tokens },
      },
    })),

    addTotalDollars: (amount) => set((state) => ({
      resources: {
        ...state.resources,
        dollars: {
          ...state.resources.dollars,
          total: state.resources.dollars.total + amount,
        },
      },
    })),

    addTotalTokens: (amount) => set((state) => ({
      resources: {
        ...state.resources,
        tokens: {
          ...state.resources.tokens,
          total: state.resources.tokens.total + amount,
        },
      },
    })),

    // NOTE: Work stats actions removed - now handled by useWorkStatsFromEvents hook via EventBus

    // Swarm actions
    setSwarmStatus: (status) => set({ swarmStatus: status }),

    // Reset
    reset: () => set(initialState),
  }))
);

// Type exports
export type { Board, Entity, AgentEntity, ToolEntity, Connection, HexData };

