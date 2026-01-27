use rusqlite::{Connection, Result as SqliteResult, params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;
use chrono::Utc;

/// Database state managed by Tauri
pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> SqliteResult<Self> {
        std::fs::create_dir_all(&app_data_dir).ok();
        let db_path = app_data_dir.join("ainulindale.db");
        let conn = Connection::open(db_path)?;

        // Run migrations before schema initialization
        Self::run_migrations(&conn)?;

        // Initialize schema
        conn.execute_batch(include_str!("schema.sql"))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Run database migrations to update old schemas
    fn run_migrations(conn: &Connection) -> SqliteResult<()> {
        // Check if boards table exists and has old column names
        let has_old_columns: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('boards') WHERE name = 'max_dollars_per_day'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0) > 0;

        if has_old_columns {
            println!("[Database] Migrating boards table to new budget naming convention...");

            // SQLite doesn't support direct column rename before 3.25.0
            // Use table recreation approach for compatibility
            conn.execute_batch(
                "
                -- Create new table with new column names
                CREATE TABLE IF NOT EXISTS boards_new (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'stopped',
                    max_dollars REAL NOT NULL DEFAULT 500.0,
                    max_tokens INTEGER NOT NULL DEFAULT 10000000,
                    total_dollars REAL NOT NULL DEFAULT 0.0,
                    total_tokens INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                -- Copy data from old table to new table, mapping old column names to new ones
                INSERT INTO boards_new (id, name, status, max_dollars, max_tokens, total_dollars, total_tokens, created_at, updated_at)
                SELECT id, name, status, max_dollars_per_day, max_tokens_per_day, dollars_spent_today, tokens_used_today, created_at, updated_at
                FROM boards;

                -- Drop old table
                DROP TABLE boards;

                -- Rename new table to original name
                ALTER TABLE boards_new RENAME TO boards;
                "
            )?;

            println!("[Database] Migration complete: boards table updated");
        }

        Ok(())
    }
}

// === Board Types ===
// Budget naming convention:
//   max_dollars / max_tokens = budget limits
//   total_dollars / total_tokens = persistent totals since board creation

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub name: String,
    pub status: String,
    pub max_dollars: f64,
    pub max_tokens: i64,
    pub total_dollars: f64,
    pub total_tokens: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBoardRequest {
    pub name: String,
    pub max_dollars: Option<f64>,
    pub max_tokens: Option<i64>,
}

// === Hex/Entity Types ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexEntity {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub category: String,
    pub entity_type: String,
    pub position_q: i32,
    pub position_r: i32,
    pub config: String, // JSON string
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateHexRequest {
    pub name: String,
    pub category: String,
    pub entity_type: String,
    pub position_q: i32,
    pub position_r: i32,
    pub config: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection_ {
    pub id: String,
    pub board_id: String,
    pub from_hex_id: String,
    pub to_hex_id: String,
    pub connection_type: String,
    pub created_at: String,
}

// === Database Operations ===

impl Database {
    // Board CRUD
    pub fn create_board(&self, req: CreateBoardRequest) -> SqliteResult<Board> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO boards (id, name, status, max_dollars, max_tokens, created_at, updated_at)
             VALUES (?1, ?2, 'stopped', ?3, ?4, ?5, ?6)",
            params![
                &id,
                &req.name,
                req.max_dollars.unwrap_or(500.0),
                req.max_tokens.unwrap_or(10_000_000),
                &now,
                &now,
            ],
        )?;

        Ok(Board {
            id,
            name: req.name,
            status: "stopped".to_string(),
            max_dollars: req.max_dollars.unwrap_or(500.0),
            max_tokens: req.max_tokens.unwrap_or(10_000_000),
            total_dollars: 0.0,
            total_tokens: 0,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_boards(&self) -> SqliteResult<Vec<Board>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, status, max_dollars, max_tokens,
                    total_dollars, total_tokens, created_at, updated_at
             FROM boards ORDER BY created_at DESC"
        )?;

        let boards = stmt.query_map([], |row| {
            Ok(Board {
                id: row.get(0)?,
                name: row.get(1)?,
                status: row.get(2)?,
                max_dollars: row.get(3)?,
                max_tokens: row.get(4)?,
                total_dollars: row.get(5)?,
                total_tokens: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?.collect::<SqliteResult<Vec<_>>>()?;
        
        Ok(boards)
    }

    pub fn get_board(&self, id: &str) -> SqliteResult<Option<Board>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, status, max_dollars, max_tokens,
                    total_dollars, total_tokens, created_at, updated_at
             FROM boards WHERE id = ?1"
        )?;

        let board = stmt.query_row([id], |row| {
            Ok(Board {
                id: row.get(0)?,
                name: row.get(1)?,
                status: row.get(2)?,
                max_dollars: row.get(3)?,
                max_tokens: row.get(4)?,
                total_dollars: row.get(5)?,
                total_tokens: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        }).optional()?;

        Ok(board)
    }

    pub fn update_board(&self, id: &str, name: Option<String>, status: Option<String>,
                        max_dollars: Option<f64>, max_tokens: Option<i64>) -> SqliteResult<Option<Board>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        // Simple approach: update each field if provided
        conn.execute("UPDATE boards SET updated_at = ?1 WHERE id = ?2", params![&now, id])?;

        if let Some(n) = &name {
            conn.execute("UPDATE boards SET name = ?1 WHERE id = ?2", params![n, id])?;
        }
        if let Some(s) = &status {
            conn.execute("UPDATE boards SET status = ?1 WHERE id = ?2", params![s, id])?;
        }
        if let Some(d) = max_dollars {
            conn.execute("UPDATE boards SET max_dollars = ?1 WHERE id = ?2", params![d, id])?;
        }
        if let Some(t) = max_tokens {
            conn.execute("UPDATE boards SET max_tokens = ?1 WHERE id = ?2", params![t, id])?;
        }

        drop(conn);
        self.get_board(id)
    }

    /// Atomically increment the persistent total usage for a board.
    /// Returns the updated totals (total_dollars, total_tokens) after the increment.
    pub fn add_board_usage(&self, id: &str, dollars: f64, tokens: i64) -> SqliteResult<Option<(f64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        // Atomically increment the total usage counters
        let rows_updated = conn.execute(
            "UPDATE boards SET
                total_dollars = total_dollars + ?1,
                total_tokens = total_tokens + ?2,
                updated_at = ?3
             WHERE id = ?4",
            params![dollars, tokens, &now, id],
        )?;

        if rows_updated == 0 {
            return Ok(None);
        }

        // Return the new totals
        let mut stmt = conn.prepare(
            "SELECT total_dollars, total_tokens FROM boards WHERE id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            Ok((row.get::<_, f64>(0)?, row.get::<_, i64>(1)?))
        }).optional()?;

        Ok(result)
    }

    /// Reset the total usage counters for a board
    pub fn reset_board_usage(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        let rows_updated = conn.execute(
            "UPDATE boards SET
                total_dollars = 0.0,
                total_tokens = 0,
                updated_at = ?1
             WHERE id = ?2",
            params![&now, id],
        )?;

        Ok(rows_updated > 0)
    }

    pub fn delete_board(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute("DELETE FROM boards WHERE id = ?1", [id])?;
        Ok(deleted > 0)
    }

    // Hex Entity CRUD
    pub fn create_hex(&self, board_id: &str, req: CreateHexRequest) -> SqliteResult<HexEntity> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let config = req.config.unwrap_or_else(|| "{}".to_string());

        conn.execute(
            "INSERT INTO hex_entities (id, board_id, name, category, entity_type, position_q, position_r, config, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'idle', ?9, ?10)",
            params![&id, board_id, &req.name, &req.category, &req.entity_type, req.position_q, req.position_r, &config, &now, &now],
        )?;

        Ok(HexEntity {
            id,
            board_id: board_id.to_string(),
            name: req.name,
            category: req.category,
            entity_type: req.entity_type,
            position_q: req.position_q,
            position_r: req.position_r,
            config,
            status: "idle".to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_hexes(&self, board_id: &str) -> SqliteResult<Vec<HexEntity>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, board_id, name, category, entity_type, position_q, position_r, config, status, created_at, updated_at
             FROM hex_entities WHERE board_id = ?1"
        )?;

        let hexes = stmt.query_map([board_id], |row| {
            Ok(HexEntity {
                id: row.get(0)?,
                board_id: row.get(1)?,
                name: row.get(2)?,
                category: row.get(3)?,
                entity_type: row.get(4)?,
                position_q: row.get(5)?,
                position_r: row.get(6)?,
                config: row.get(7)?,
                status: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?.collect::<SqliteResult<Vec<_>>>()?;

        Ok(hexes)
    }

    pub fn get_hex(&self, id: &str) -> SqliteResult<Option<HexEntity>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, board_id, name, category, entity_type, position_q, position_r, config, status, created_at, updated_at
             FROM hex_entities WHERE id = ?1"
        )?;

        stmt.query_row([id], |row| {
            Ok(HexEntity {
                id: row.get(0)?,
                board_id: row.get(1)?,
                name: row.get(2)?,
                category: row.get(3)?,
                entity_type: row.get(4)?,
                position_q: row.get(5)?,
                position_r: row.get(6)?,
                config: row.get(7)?,
                status: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        }).optional()
    }

    pub fn update_hex(&self, id: &str, name: Option<String>, config: Option<String>, status: Option<String>) -> SqliteResult<Option<HexEntity>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        if let Some(n) = &name {
            conn.execute("UPDATE hex_entities SET name = ?1, updated_at = ?2 WHERE id = ?3", params![n, &now, id])?;
        }
        if let Some(c) = &config {
            conn.execute("UPDATE hex_entities SET config = ?1, updated_at = ?2 WHERE id = ?3", params![c, &now, id])?;
        }
        if let Some(s) = &status {
            conn.execute("UPDATE hex_entities SET status = ?1, updated_at = ?2 WHERE id = ?3", params![s, &now, id])?;
        }

        drop(conn);
        self.get_hex(id)
    }

    pub fn delete_hex(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute("DELETE FROM hex_entities WHERE id = ?1", [id])?;
        Ok(deleted > 0)
    }

    // Connections
    pub fn create_connection(&self, board_id: &str, from_hex_id: &str, to_hex_id: &str, conn_type: &str) -> SqliteResult<Connection_> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO connections (id, board_id, from_hex_id, to_hex_id, connection_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![&id, board_id, from_hex_id, to_hex_id, conn_type, &now],
        )?;

        Ok(Connection_ {
            id,
            board_id: board_id.to_string(),
            from_hex_id: from_hex_id.to_string(),
            to_hex_id: to_hex_id.to_string(),
            connection_type: conn_type.to_string(),
            created_at: now,
        })
    }

    pub fn list_connections(&self, board_id: &str) -> SqliteResult<Vec<Connection_>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, board_id, from_hex_id, to_hex_id, connection_type, created_at
             FROM connections WHERE board_id = ?1"
        )?;

        let conns = stmt.query_map([board_id], |row| {
            Ok(Connection_ {
                id: row.get(0)?,
                board_id: row.get(1)?,
                from_hex_id: row.get(2)?,
                to_hex_id: row.get(3)?,
                connection_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?.collect::<SqliteResult<Vec<_>>>()?;

        Ok(conns)
    }

    pub fn delete_connection(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute("DELETE FROM connections WHERE id = ?1", [id])?;
        Ok(deleted > 0)
    }

    // Settings (key-value store for API keys, preferences, etc.)
    pub fn get_setting(&self, key: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let value = stmt.query_row([key], |row| row.get(0)).optional()?;
        Ok(value)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        // Upsert: insert or replace
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, &now],
        )?;

        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;
        Ok(deleted > 0)
    }

    pub fn list_settings(&self, prefix: Option<&str>) -> SqliteResult<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();

        if let Some(p) = prefix {
            let pattern = format!("{}%", p);
            let mut stmt = conn.prepare("SELECT key, value FROM settings WHERE key LIKE ?1")?;
            let rows = stmt.query_map([&pattern], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let settings: Vec<(String, String)> = rows.collect::<SqliteResult<Vec<_>>>()?;
            Ok(settings)
        } else {
            let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let settings: Vec<(String, String)> = rows.collect::<SqliteResult<Vec<_>>>()?;
            Ok(settings)
        }
    }
}

