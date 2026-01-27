use tauri::State;
use crate::database::{Database, Board, CreateBoardRequest, HexEntity, CreateHexRequest, Connection_};

/// Error type for database command operations
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Not found: {0}")]
    NotFound(String),
}

impl serde::Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// === Board Commands ===

#[tauri::command]
pub fn db_create_board(db: State<Database>, name: String, max_dollars: Option<f64>, max_tokens: Option<i64>) -> Result<Board, DbError> {
    let req = CreateBoardRequest {
        name,
        max_dollars,
        max_tokens,
    };
    Ok(db.create_board(req)?)
}

#[tauri::command]
pub fn db_list_boards(db: State<Database>) -> Result<Vec<Board>, DbError> {
    Ok(db.list_boards()?)
}

#[tauri::command]
pub fn db_get_board(db: State<Database>, id: String) -> Result<Board, DbError> {
    db.get_board(&id)?
        .ok_or_else(|| DbError::NotFound(format!("Board not found: {}", id)))
}

#[tauri::command]
pub fn db_update_board(db: State<Database>, id: String, name: Option<String>, status: Option<String>, max_dollars: Option<f64>, max_tokens: Option<i64>) -> Result<Board, DbError> {
    db.update_board(&id, name, status, max_dollars, max_tokens)?
        .ok_or_else(|| DbError::NotFound(format!("Board not found: {}", id)))
}

#[tauri::command]
pub fn db_delete_board(db: State<Database>, id: String) -> Result<bool, DbError> {
    Ok(db.delete_board(&id)?)
}

/// Atomically add to the persistent usage totals for a board.
/// Returns (new_total_dollars, new_total_tokens) after the increment.
#[tauri::command]
pub fn db_add_board_usage(db: State<Database>, id: String, dollars: f64, tokens: i64) -> Result<(f64, i64), DbError> {
    db.add_board_usage(&id, dollars, tokens)?
        .ok_or_else(|| DbError::NotFound(format!("Board not found: {}", id)))
}

/// Reset the usage counters for a board
#[tauri::command]
pub fn db_reset_board_usage(db: State<Database>, id: String) -> Result<bool, DbError> {
    Ok(db.reset_board_usage(&id)?)
}

// === Hex Entity Commands ===

#[tauri::command]
pub fn db_create_hex(db: State<Database>, board_id: String, name: String, category: String, entity_type: String, position_q: i32, position_r: i32, config: Option<String>) -> Result<HexEntity, DbError> {
    let req = CreateHexRequest {
        name,
        category,
        entity_type,
        position_q,
        position_r,
        config,
    };
    Ok(db.create_hex(&board_id, req)?)
}

#[tauri::command]
pub fn db_list_hexes(db: State<Database>, board_id: String) -> Result<Vec<HexEntity>, DbError> {
    Ok(db.list_hexes(&board_id)?)
}

#[tauri::command]
pub fn db_get_hex(db: State<Database>, id: String) -> Result<HexEntity, DbError> {
    db.get_hex(&id)?
        .ok_or_else(|| DbError::NotFound(format!("Hex not found: {}", id)))
}

#[tauri::command]
pub fn db_update_hex(db: State<Database>, id: String, name: Option<String>, config: Option<String>, status: Option<String>) -> Result<HexEntity, DbError> {
    db.update_hex(&id, name, config, status)?
        .ok_or_else(|| DbError::NotFound(format!("Hex not found: {}", id)))
}

#[tauri::command]
pub fn db_delete_hex(db: State<Database>, id: String) -> Result<bool, DbError> {
    Ok(db.delete_hex(&id)?)
}

// === Connection Commands ===

#[tauri::command]
pub fn db_create_connection(db: State<Database>, board_id: String, from_hex_id: String, to_hex_id: String, connection_type: String) -> Result<Connection_, DbError> {
    Ok(db.create_connection(&board_id, &from_hex_id, &to_hex_id, &connection_type)?)
}

#[tauri::command]
pub fn db_list_connections(db: State<Database>, board_id: String) -> Result<Vec<Connection_>, DbError> {
    Ok(db.list_connections(&board_id)?)
}

#[tauri::command]
pub fn db_delete_connection(db: State<Database>, id: String) -> Result<bool, DbError> {
    Ok(db.delete_connection(&id)?)
}

// === Settings Commands ===

#[tauri::command]
pub fn db_get_setting(db: State<Database>, key: String) -> Result<Option<String>, DbError> {
    Ok(db.get_setting(&key)?)
}

#[tauri::command]
pub fn db_set_setting(db: State<Database>, key: String, value: String) -> Result<(), DbError> {
    Ok(db.set_setting(&key, &value)?)
}

#[tauri::command]
pub fn db_delete_setting(db: State<Database>, key: String) -> Result<bool, DbError> {
    Ok(db.delete_setting(&key)?)
}

#[tauri::command]
pub fn db_list_settings(db: State<Database>, prefix: Option<String>) -> Result<Vec<(String, String)>, DbError> {
    Ok(db.list_settings(prefix.as_deref())?)
}
