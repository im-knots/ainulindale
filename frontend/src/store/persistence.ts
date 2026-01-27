/**
 * SQLite Persistence Middleware for Zustand
 * Syncs state changes with Tauri SQLite database
 */

import { useStore } from './index';
import * as db from '../services/tauriDatabase';
import { Entity, ToolEntity, Board, Connection } from './types';
import { HexData, HexGrid } from '../hex/grid';
import { eventBus } from '../engine/event-bus';

// Grid radius - should match ThreeCanvas
const GRID_RADIUS = 5;

// Debounce timers for entity saves
const entitySaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DEBOUNCE_MS = 1000;

/**
 * Initialize store from SQLite database
 */
export async function initializeFromDatabase(): Promise<void> {
  const store = useStore.getState();
  
  try {
    store.setBoardLoading(true);
    store.setBoardError(null);
    
    // Load boards from database
    const boards = await db.listBoards();
    store.setBoards(boards);
    
    // If there's a stored last-used board, load it
    const lastBoardId = await db.getSetting('lastBoardId');
    if (lastBoardId && boards.some(b => b.id === lastBoardId)) {
      await loadBoard(lastBoardId);
    } else if (boards.length > 0) {
      await loadBoard(boards[0].id);
    }
    
    store.setBoardLoading(false);
  } catch (error) {
    console.error('[Persistence] Failed to initialize from database:', error);
    store.setBoardError(error instanceof Error ? error.message : 'Failed to load boards');
    store.setBoardLoading(false);
  }
}

/**
 * Load a specific board and its entities/connections
 */
export async function loadBoard(boardId: string): Promise<void> {
  const store = useStore.getState();

  console.log('[loadBoard] Loading board:', boardId);

  try {
    store.setBoardLoading(true);

    // Get board details
    const board = await db.getBoard(boardId);
    console.log('[loadBoard] Got board:', board?.name);
    store.setCurrentBoard(board);
    
    // Save as last used board
    await db.setSetting('lastBoardId', boardId);
    
    // Load hexes/entities
    const hexEntities = await db.listHexes(boardId);
    console.log('[loadBoard] Loaded hexEntities from DB:', hexEntities.length);

    // First, create the full grid with empty hexes
    const grid = new HexGrid(GRID_RADIUS);
    const hexes = new Map<string, HexData>();
    const entities = new Map<string, Entity>();

    // Populate all grid hexes (empty by default)
    for (const gridHex of grid.getAllHexes()) {
      hexes.set(gridHex.key, {
        key: gridHex.key,
        coord: gridHex.coord,
        isEdge: gridHex.isEdge,
        // entityId will be undefined for empty hexes
      });
    }

    // Now overlay entities from the database
    for (const hexEntity of hexEntities) {
      console.log('[loadBoard] Processing hex entity:', hexEntity.name, 'at', hexEntity.position_q, hexEntity.position_r);
      const hexKey = `${hexEntity.position_q},${hexEntity.position_r}`;
      const config = hexEntity.config ? JSON.parse(hexEntity.config) : {};

      // Update hex data with entity reference
      const existingHex = hexes.get(hexKey);
      hexes.set(hexKey, {
        key: hexKey,
        coord: { q: hexEntity.position_q, r: hexEntity.position_r },
        isEdge: existingHex?.isEdge,
        entityId: hexEntity.id,
      });

      // Create entity from config
      const entity: Entity = {
        id: hexEntity.id,
        category: hexEntity.category as 'agent' | 'tool',
        name: hexEntity.name,
        cost: config.cost ?? 0,
        status: (hexEntity.status as Entity['status']) ?? 'idle',
        ...config,
      };

      entities.set(hexEntity.id, entity);
    }
    
    // Load connections
    const dbConnections = await db.listConnections(boardId);
    const connections: Connection[] = dbConnections.map(c => ({
      id: c.id,
      from: c.from_hex_id,
      to: c.to_hex_id,
      type: c.connection_type as 'flow' | 'hierarchy' | 'data',
    }));
    
    // Update store atomically using the proper action
    console.log('[loadBoard] Loading board state - hexes:', hexes.size, 'entities:', entities.size, 'connections:', connections.length);
    store.loadBoardState(hexes, entities, connections);
    
    // Update resources from board using unified naming:
    //   max_dollars / max_tokens = budget limits
    //   total_dollars / total_tokens = persistent totals
    store.updateResources({
      dollars: {
        max: board.max_dollars,
        total: board.total_dollars,
        projected: 0,
        rate: 0,
      },
      tokens: {
        max: board.max_tokens,
        total: board.total_tokens,
        projected: 0,
        rate: 0,
      },
    });
    
    store.setBoardLoading(false);

    // Emit board.loaded event to reset work stats and other metrics
    eventBus.emit({
      type: 'board.loaded',
      boardId: board.id,
      hexId: '',
      timestamp: new Date(),
      data: { boardName: board.name },
    });
  } catch (error) {
    console.error('[Persistence] Failed to load board:', error);
    store.setBoardError(error instanceof Error ? error.message : 'Failed to load board');
    store.setBoardLoading(false);
  }
}

/**
 * Save an entity to the database (debounced)
 */
export function scheduleEntitySave(entityId: string): void {
  // Clear existing timer
  const existingTimer = entitySaveTimers.get(entityId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  // Schedule new save
  const timer = setTimeout(async () => {
    await saveEntityToDatabase(entityId);
    entitySaveTimers.delete(entityId);
  }, SAVE_DEBOUNCE_MS);
  
  entitySaveTimers.set(entityId, timer);
}

/**
 * Save entity to database immediately
 */
export async function saveEntityToDatabase(entityId: string): Promise<void> {
  const state = useStore.getState();
  const entity = state.entities.get(entityId);
  if (!entity) return;
  
  try {
    // Build config from entity, excluding base fields
    const { id, category, name, status, ...config } = entity;
    
    await db.updateHex(entityId, {
      name: entity.name,
      config: config,
      status: entity.status,
    });
  } catch (error) {
    console.error('[Persistence] Failed to save entity:', error);
  }
}

/**
 * Flush all pending entity saves immediately
 */
export async function flushPendingEntitySaves(): Promise<void> {
  const pendingEntityIds = Array.from(entitySaveTimers.keys());
  if (pendingEntityIds.length === 0) return;

  console.log(`[Persistence] Flushing ${pendingEntityIds.length} pending entity saves`);

  // Clear all timers
  for (const timer of entitySaveTimers.values()) {
    clearTimeout(timer);
  }
  entitySaveTimers.clear();

  // Save all pending entities
  await Promise.all(
    pendingEntityIds.map(entityId => saveEntityToDatabase(entityId))
  );
}

/**
 * Create a new board and add it to the store
 */
export async function createBoard(name: string): Promise<Board> {
  const store = useStore.getState();

  const board = await db.createBoard(name);
  const boards = [...store.boards, board];
  store.setBoards(boards);

  return board;
}

/**
 * Delete a board from the database and store
 */
export async function deleteBoard(boardId: string): Promise<void> {
  const store = useStore.getState();

  await db.deleteBoard(boardId);
  const boards = store.boards.filter(b => b.id !== boardId);
  store.setBoards(boards);

  // If we deleted the current board, load another one
  if (store.currentBoard?.id === boardId) {
    if (boards.length > 0) {
      await loadBoard(boards[0].id);
    } else {
      store.setCurrentBoard(null);
      useStore.setState({ hexes: new Map(), entities: new Map(), connections: [] });
    }
  }
}

/**
 * Place an entity on a hex (create in database and store)
 */
export async function placeEntity(
  hexKey: string,
  entity: Entity
): Promise<void> {
  const store = useStore.getState();
  const board = store.currentBoard;
  if (!board) throw new Error('No board selected');

  // Parse hex coordinates
  const [q, r] = hexKey.split(',').map(Number);

  // Build config from entity
  const { id, category, name, status, ...config } = entity;

  // Create in database
  const hexEntity = await db.createHex(board.id, {
    name: entity.name,
    category: entity.category,
    entityType: entity.category === 'agent' ? 'agent' : (entity as ToolEntity).toolType,
    positionQ: q,
    positionR: r,
    config,
  });

  // Update entity with database-assigned ID
  const entityWithId: Entity = {
    ...entity,
    id: hexEntity.id,
  };

  // Add to store - React hooks will trigger re-render automatically
  console.log('[placeEntity] Adding entity to store:', entityWithId.name, 'id:', entityWithId.id, 'hex:', hexKey);
  store.addEntity(entityWithId, hexKey);
}

/**
 * Remove an entity from hex (delete from database and store)
 */
export async function removeEntity(entityId: string): Promise<void> {
  const store = useStore.getState();

  await db.deleteHex(entityId);
  store.removeEntity(entityId);
}

/**
 * Add a connection between hexes
 */
export async function addConnection(
  fromHexKey: string,
  toHexKey: string,
  type: 'flow' | 'hierarchy' | 'data' = 'flow'
): Promise<void> {
  const store = useStore.getState();
  const board = store.currentBoard;
  if (!board) throw new Error('No board selected');

  // Get entity IDs from hex keys
  const fromHex = store.hexes.get(fromHexKey);
  const toHex = store.hexes.get(toHexKey);
  if (!fromHex?.entityId || !toHex?.entityId) {
    throw new Error('Both hexes must have entities');
  }

  const dbConnection = await db.createConnection(
    board.id,
    fromHex.entityId,
    toHex.entityId,
    type
  );

  store.addConnection({
    id: dbConnection.id,
    from: fromHex.entityId,
    to: toHex.entityId,
    type,
  });
}

/**
 * Remove a connection
 */
export async function removeConnection(connectionId: string): Promise<void> {
  const store = useStore.getState();

  await db.deleteConnection(connectionId);
  store.removeConnection(connectionId);
}

/**
 * Subscribe to store changes and auto-save entities
 * Returns unsubscribe function
 */
export function setupPersistenceSubscriptions(): () => void {
  // Subscribe to entity changes for auto-save
  const unsubscribe = useStore.subscribe(
    (state) => state.entities,
    (entities, prevEntities) => {
      // Find changed entities and schedule saves
      for (const [entityId, entity] of entities) {
        const prevEntity = prevEntities.get(entityId);
        if (prevEntity && entity !== prevEntity) {
          scheduleEntitySave(entityId);
        }
      }
    }
  );

  // Set up beforeunload handler to flush pending saves
  const handleBeforeUnload = () => {
    flushPendingEntitySaves();
  };
  window.addEventListener('beforeunload', handleBeforeUnload);

  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', handleBeforeUnload);
    flushPendingEntitySaves();
  };
}

