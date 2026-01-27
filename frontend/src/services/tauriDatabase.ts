/**
 * Tauri Database Service
 * Replaces HTTP-based boardService with local SQLite via Tauri IPC
 *
 * Budget naming convention:
 *   max_dollars / max_tokens = budget limits
 *   total_dollars / total_tokens = persistent totals since board creation
 */

import { invoke } from '@tauri-apps/api/core';

// === Types ===

export type BoardStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

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

export interface HexEntity {
  id: string;
  board_id: string;
  name: string;
  category: string;
  entity_type: string;
  position_q: number;
  position_r: number;
  config: string; // JSON string
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Connection {
  id: string;
  board_id: string;
  from_hex_id: string;
  to_hex_id: string;
  connection_type: string;
  created_at: string;
}

// === Board Operations ===

export async function createBoard(
  name: string,
  maxDollars?: number,
  maxTokens?: number
): Promise<Board> {
  return invoke<Board>('db_create_board', {
    name,
    maxDollars,
    maxTokens,
  });
}

export async function listBoards(): Promise<Board[]> {
  return invoke<Board[]>('db_list_boards');
}

export async function getBoard(id: string): Promise<Board> {
  return invoke<Board>('db_get_board', { id });
}

export async function updateBoard(
  id: string,
  updates: {
    name?: string;
    status?: string;
    maxDollars?: number;
    maxTokens?: number;
  }
): Promise<Board> {
  return invoke<Board>('db_update_board', {
    id,
    name: updates.name,
    status: updates.status,
    maxDollars: updates.maxDollars,
    maxTokens: updates.maxTokens,
  });
}

export async function deleteBoard(id: string): Promise<boolean> {
  return invoke<boolean>('db_delete_board', { id });
}

/**
 * Atomically add to the persistent usage totals for a board.
 * Returns [new_total_dollars, new_total_tokens] after the increment.
 */
export async function addBoardUsage(
  id: string,
  dollars: number,
  tokens: number
): Promise<[number, number]> {
  return invoke<[number, number]>('db_add_board_usage', {
    id,
    dollars,
    tokens,
  });
}

/**
 * Reset the usage counters for a board (e.g., for a daily reset).
 */
export async function resetBoardUsage(id: string): Promise<boolean> {
  return invoke<boolean>('db_reset_board_usage', { id });
}

// === Hex Entity Operations ===

export async function createHex(
  boardId: string,
  data: {
    name: string;
    category: string;
    entityType: string;
    positionQ: number;
    positionR: number;
    config?: Record<string, unknown>;
  }
): Promise<HexEntity> {
  return invoke<HexEntity>('db_create_hex', {
    boardId,
    name: data.name,
    category: data.category,
    entityType: data.entityType,
    positionQ: data.positionQ,
    positionR: data.positionR,
    config: data.config ? JSON.stringify(data.config) : undefined,
  });
}

export async function listHexes(boardId: string): Promise<HexEntity[]> {
  return invoke<HexEntity[]>('db_list_hexes', { boardId });
}

export async function getHex(id: string): Promise<HexEntity> {
  return invoke<HexEntity>('db_get_hex', { id });
}

export async function updateHex(
  id: string,
  updates: {
    name?: string;
    config?: Record<string, unknown>;
    status?: string;
  }
): Promise<HexEntity> {
  return invoke<HexEntity>('db_update_hex', {
    id,
    name: updates.name,
    config: updates.config ? JSON.stringify(updates.config) : undefined,
    status: updates.status,
  });
}

export async function deleteHex(id: string): Promise<boolean> {
  return invoke<boolean>('db_delete_hex', { id });
}

// === Connection Operations ===

export async function createConnection(
  boardId: string,
  fromHexId: string,
  toHexId: string,
  connectionType: string = 'flow'
): Promise<Connection> {
  return invoke<Connection>('db_create_connection', {
    boardId,
    fromHexId,
    toHexId,
    connectionType,
  });
}

export async function listConnections(boardId: string): Promise<Connection[]> {
  return invoke<Connection[]>('db_list_connections', { boardId });
}

export async function deleteConnection(id: string): Promise<boolean> {
  return invoke<boolean>('db_delete_connection', { id });
}

// === Settings Operations ===

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('db_get_setting', { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>('db_set_setting', { key, value });
}

export async function deleteSetting(key: string): Promise<boolean> {
  return invoke<boolean>('db_delete_setting', { key });
}

export async function listSettings(prefix?: string): Promise<[string, string][]> {
  return invoke<[string, string][]>('db_list_settings', { prefix });
}
