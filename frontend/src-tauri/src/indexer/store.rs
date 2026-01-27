//! Vector storage using SQLite with sqlite-vec extension
//!
//! Stores code chunk embeddings and provides KNN search functionality.

use super::{CodeChunk, SearchResult};
use rusqlite::{ffi::sqlite3_auto_extension, params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StoreError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Failed to serialize embedding: {0}")]
    Serialization(String),
    #[error("Store not initialized")]
    NotInitialized,
}

/// Vector store for code chunk embeddings
pub struct VectorStore {
    conn: Mutex<Option<Connection>>,
    embedding_dim: usize,
}

impl VectorStore {
    /// Create a new vector store
    pub fn new(embedding_dim: usize) -> Self {
        Self {
            conn: Mutex::new(None),
            embedding_dim,
        }
    }

    /// Initialize the store with a database path
    pub fn initialize(&self, db_path: PathBuf) -> Result<(), StoreError> {
        // Register sqlite-vec extension before opening connection
        unsafe {
            sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }

        let conn = Connection::open(&db_path)?;

        // Create tables
        conn.execute_batch(&format!(
            r#"
            CREATE TABLE IF NOT EXISTS code_chunks (
                id TEXT PRIMARY KEY,
                filesystem_hex_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                content TEXT NOT NULL,
                language TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_chunks_filesystem 
                ON code_chunks(filesystem_hex_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_file 
                ON code_chunks(filesystem_hex_id, file_path);
            
            CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
                chunk_id TEXT PRIMARY KEY,
                embedding float[{dim}]
            );
            "#,
            dim = self.embedding_dim
        ))?;

        *self.conn.lock().unwrap() = Some(conn);
        Ok(())
    }

    /// Check if the store is initialized
    pub fn is_initialized(&self) -> bool {
        self.conn.lock().unwrap().is_some()
    }

    /// Insert a chunk with its embedding
    pub fn insert(&self, chunk: &CodeChunk, embedding: &[f32]) -> Result<(), StoreError> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or(StoreError::NotInitialized)?;

        // Insert chunk metadata
        conn.execute(
            r#"INSERT OR REPLACE INTO code_chunks 
               (id, filesystem_hex_id, file_path, start_line, end_line, content, language)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params![
                chunk.id,
                chunk.filesystem_hex_id,
                chunk.file_path,
                chunk.start_line,
                chunk.end_line,
                chunk.content,
                chunk.language
            ],
        )?;

        // Insert embedding as JSON array
        let embedding_json = serde_json::to_string(embedding)
            .map_err(|e| StoreError::Serialization(e.to_string()))?;

        conn.execute(
            "INSERT OR REPLACE INTO chunk_embeddings (chunk_id, embedding) VALUES (?1, ?2)",
            params![chunk.id, embedding_json],
        )?;

        Ok(())
    }

    /// Remove all chunks for a file
    pub fn remove_file(&self, filesystem_hex_id: &str, file_path: &str) -> Result<usize, StoreError> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or(StoreError::NotInitialized)?;

        // Get chunk IDs for this file
        let mut stmt = conn.prepare(
            "SELECT id FROM code_chunks WHERE filesystem_hex_id = ?1 AND file_path = ?2"
        )?;
        let chunk_ids: Vec<String> = stmt
            .query_map(params![filesystem_hex_id, file_path], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        // Delete embeddings
        for chunk_id in &chunk_ids {
            conn.execute(
                "DELETE FROM chunk_embeddings WHERE chunk_id = ?1",
                params![chunk_id],
            )?;
        }

        // Delete chunks
        let deleted = conn.execute(
            "DELETE FROM code_chunks WHERE filesystem_hex_id = ?1 AND file_path = ?2",
            params![filesystem_hex_id, file_path],
        )?;

        Ok(deleted)
    }

    /// Search for similar chunks using KNN
    pub fn search(
        &self,
        query_embedding: &[f32],
        filesystem_hex_ids: &[String],
        limit: usize,
    ) -> Result<Vec<SearchResult>, StoreError> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or(StoreError::NotInitialized)?;

        let embedding_json = serde_json::to_string(query_embedding)
            .map_err(|e| StoreError::Serialization(e.to_string()))?;

        // Build filesystem filter
        let fs_filter = if filesystem_hex_ids.is_empty() {
            "1=1".to_string()
        } else {
            let placeholders: Vec<String> = filesystem_hex_ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 3))
                .collect();
            format!("c.filesystem_hex_id IN ({})", placeholders.join(","))
        };

        let query = format!(
            r#"
            SELECT
                c.id, c.filesystem_hex_id, c.file_path, c.start_line, c.end_line,
                c.content, c.language, e.distance
            FROM chunk_embeddings e
            INNER JOIN code_chunks c ON e.chunk_id = c.id
            WHERE e.embedding MATCH ?1
              AND k = ?2
              AND {}
            ORDER BY e.distance
            "#,
            fs_filter
        );

        let mut stmt = conn.prepare(&query)?;

        // Build params
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![
            Box::new(embedding_json),
            Box::new(limit as i32),
        ];
        for fs_id in filesystem_hex_ids {
            params_vec.push(Box::new(fs_id.clone()));
        }

        let results = stmt.query_map(
            rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref())),
            |row| {
                Ok(SearchResult {
                    chunk: CodeChunk {
                        id: row.get(0)?,
                        filesystem_hex_id: row.get(1)?,
                        file_path: row.get(2)?,
                        start_line: row.get(3)?,
                        end_line: row.get(4)?,
                        content: row.get(5)?,
                        language: row.get(6)?,
                    },
                    distance: row.get(7)?,
                })
            },
        )?;

        results.collect::<Result<Vec<_>, _>>().map_err(StoreError::Database)
    }

    /// Get count of chunks for a filesystem hex
    pub fn get_chunk_count(&self, filesystem_hex_id: &str) -> Result<usize, StoreError> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or(StoreError::NotInitialized)?;

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM code_chunks WHERE filesystem_hex_id = ?1",
            params![filesystem_hex_id],
            |row| row.get(0),
        )?;

        Ok(count as usize)
    }

    /// Get all indexed files for a filesystem hex
    pub fn get_indexed_files(&self, filesystem_hex_id: &str) -> Result<Vec<String>, StoreError> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or(StoreError::NotInitialized)?;

        let mut stmt = conn.prepare(
            "SELECT DISTINCT file_path FROM code_chunks WHERE filesystem_hex_id = ?1"
        )?;

        let files = stmt
            .query_map(params![filesystem_hex_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(files)
    }

    /// Clear all chunks for a filesystem hex
    pub fn clear_filesystem(&self, filesystem_hex_id: &str) -> Result<usize, StoreError> {
        let conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_ref().ok_or(StoreError::NotInitialized)?;

        // Get chunk IDs
        let mut stmt = conn.prepare(
            "SELECT id FROM code_chunks WHERE filesystem_hex_id = ?1"
        )?;
        let chunk_ids: Vec<String> = stmt
            .query_map(params![filesystem_hex_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        // Delete embeddings
        for chunk_id in &chunk_ids {
            conn.execute(
                "DELETE FROM chunk_embeddings WHERE chunk_id = ?1",
                params![chunk_id],
            )?;
        }

        // Delete chunks
        let deleted = conn.execute(
            "DELETE FROM code_chunks WHERE filesystem_hex_id = ?1",
            params![filesystem_hex_id],
        )?;

        Ok(deleted)
    }
}

