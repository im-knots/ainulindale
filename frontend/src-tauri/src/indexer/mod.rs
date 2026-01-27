//! Codebase indexer for RAG-based search
//!
//! This module provides local embedding-based semantic search for codebases.
//! It uses fastembed for local embedding generation and sqlite-vec for vector storage.

pub mod chunker;
pub mod commands;
pub mod embedder;
pub mod store;
pub mod tree_sitter_parser;

use serde::{Deserialize, Serialize};

/// A chunk of code with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeChunk {
    /// Unique identifier for the chunk
    pub id: String,
    /// The filesystem hex ID this chunk belongs to
    pub filesystem_hex_id: String,
    /// File path relative to the filesystem hex root
    pub file_path: String,
    /// Starting line number (1-indexed)
    pub start_line: u32,
    /// Ending line number (1-indexed, inclusive)
    pub end_line: u32,
    /// The actual code content
    pub content: String,
    /// Optional language hint (e.g., "rust", "typescript")
    pub language: Option<String>,
}

/// A search result with similarity score
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    /// The matching code chunk
    pub chunk: CodeChunk,
    /// Cosine similarity distance (lower is more similar)
    pub distance: f32,
}

/// Configuration for the indexer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerConfig {
    /// Maximum number of lines per chunk
    pub max_chunk_lines: usize,
    /// Minimum number of lines per chunk
    pub min_chunk_lines: usize,
    /// Overlap between chunks (in lines)
    pub overlap_lines: usize,
    /// File extensions to index (empty = all text files)
    pub extensions: Vec<String>,
    /// Directories to ignore
    pub ignore_dirs: Vec<String>,
}

impl Default for IndexerConfig {
    fn default() -> Self {
        Self {
            max_chunk_lines: 50,
            min_chunk_lines: 5,
            overlap_lines: 10,
            extensions: vec![
                "rs".to_string(),
                "ts".to_string(),
                "tsx".to_string(),
                "js".to_string(),
                "jsx".to_string(),
                "py".to_string(),
                "go".to_string(),
                "java".to_string(),
                "c".to_string(),
                "cpp".to_string(),
                "h".to_string(),
                "hpp".to_string(),
                "cs".to_string(),
                "rb".to_string(),
                "php".to_string(),
                "swift".to_string(),
                "kt".to_string(),
                "scala".to_string(),
                "sql".to_string(),
                "sh".to_string(),
                "bash".to_string(),
                "zsh".to_string(),
                "yaml".to_string(),
                "yml".to_string(),
                "json".to_string(),
                "toml".to_string(),
                "xml".to_string(),
                "html".to_string(),
                "css".to_string(),
                "scss".to_string(),
                "md".to_string(),
            ],
            ignore_dirs: vec![
                "node_modules".to_string(),
                ".git".to_string(),
                "target".to_string(),
                "dist".to_string(),
                "build".to_string(),
                "__pycache__".to_string(),
                ".venv".to_string(),
                "venv".to_string(),
                ".idea".to_string(),
                ".vscode".to_string(),
                "vendor".to_string(),
            ],
        }
    }
}

