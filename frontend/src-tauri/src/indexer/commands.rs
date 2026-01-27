//! Tauri commands for codebase indexing and search
//!
//! Exposes the indexer functionality to the frontend via Tauri IPC.

use super::embedder::Embedder;
use super::store::VectorStore;
use super::{chunker, IndexerConfig, SearchResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use walkdir::WalkDir;

/// Indexer state managed by Tauri
pub struct IndexerState {
    pub embedder: Arc<Embedder>,
    pub store: Arc<VectorStore>,
    pub config: IndexerConfig,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexFileRequest {
    pub filesystem_hex_id: String,
    pub base_path: String,
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexDirectoryRequest {
    pub filesystem_hex_id: String,
    pub directory_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub filesystem_hex_ids: Vec<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexResult {
    pub chunks_indexed: usize,
    pub files_processed: usize,
}

/// Initialize the indexer (downloads model on first run)
#[tauri::command]
pub async fn indexer_initialize(
    state: State<'_, IndexerState>,
) -> Result<bool, String> {
    // Initialize embedder (downloads model if needed)
    state.embedder.initialize().map_err(|e| e.to_string())?;
    
    Ok(true)
}

/// Check if the indexer is ready
#[tauri::command]
pub fn indexer_is_ready(state: State<'_, IndexerState>) -> bool {
    state.embedder.is_initialized() && state.store.is_initialized()
}

/// Index a single file
#[tauri::command]
pub async fn indexer_index_file(
    state: State<'_, IndexerState>,
    request: IndexFileRequest,
) -> Result<usize, String> {
    // Read file content
    let full_path = Path::new(&request.base_path).join(&request.file_path);
    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Chunk the file
    let chunks = chunker::chunk_file(
        &request.filesystem_hex_id,
        &request.file_path,
        &content,
        &state.config,
    );

    if chunks.is_empty() {
        return Ok(0);
    }

    // Generate embeddings
    let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
    let embeddings = state.embedder.embed(texts).map_err(|e| e.to_string())?;

    // Remove old chunks for this file first
    state.store
        .remove_file(&request.filesystem_hex_id, &request.file_path)
        .map_err(|e| e.to_string())?;

    // Store new chunks with embeddings
    for (chunk, embedding) in chunks.iter().zip(embeddings.iter()) {
        state.store.insert(chunk, embedding).map_err(|e| e.to_string())?;
    }

    Ok(chunks.len())
}

/// Search the codebase
#[tauri::command]
pub async fn indexer_search(
    state: State<'_, IndexerState>,
    request: SearchRequest,
) -> Result<Vec<SearchResult>, String> {
    let limit = request.limit.unwrap_or(10);

    // Generate query embedding
    let query_embedding = state.embedder
        .embed_one(&request.query)
        .map_err(|e| e.to_string())?;

    // Search the vector store
    let results = state.store
        .search(&query_embedding, &request.filesystem_hex_ids, limit)
        .map_err(|e| e.to_string())?;

    Ok(results)
}

/// Remove a file from the index
#[tauri::command]
pub async fn indexer_remove_file(
    state: State<'_, IndexerState>,
    filesystem_hex_id: String,
    file_path: String,
) -> Result<usize, String> {
    state.store
        .remove_file(&filesystem_hex_id, &file_path)
        .map_err(|e| e.to_string())
}

/// Get indexing stats for a filesystem hex
#[tauri::command]
pub fn indexer_get_stats(
    state: State<'_, IndexerState>,
    filesystem_hex_id: String,
) -> Result<serde_json::Value, String> {
    let chunk_count = state.store
        .get_chunk_count(&filesystem_hex_id)
        .map_err(|e| e.to_string())?;

    let files = state.store
        .get_indexed_files(&filesystem_hex_id)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "chunk_count": chunk_count,
        "file_count": files.len(),
        "files": files
    }))
}

/// Index an entire directory recursively
#[tauri::command]
pub async fn indexer_index_directory(
    state: State<'_, IndexerState>,
    request: IndexDirectoryRequest,
) -> Result<IndexResult, String> {
    let base_path = Path::new(&request.directory_path);

    if !base_path.exists() {
        return Err(format!("Directory does not exist: {}", request.directory_path));
    }

    if !base_path.is_dir() {
        return Err(format!("Path is not a directory: {}", request.directory_path));
    }

    let mut files_processed = 0;
    let mut chunks_indexed = 0;

    // Walk the directory recursively
    for entry in WalkDir::new(base_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            // Skip ignored directories
            !state.config.ignore_dirs.iter().any(|d| name == *d)
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Skip directories
        if path.is_dir() {
            continue;
        }

        // Check extension
        let extension = path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");

        if !state.config.extensions.is_empty()
            && !state.config.extensions.iter().any(|ext| ext == extension)
        {
            continue;
        }

        // Get relative path from base
        let relative_path = path.strip_prefix(base_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string_lossy().to_string());

        // Read and index the file
        match fs::read_to_string(path) {
            Ok(content) => {
                let file_chunks = chunker::chunk_file(
                    &request.filesystem_hex_id,
                    &relative_path,
                    &content,
                    &state.config,
                );

                if file_chunks.is_empty() {
                    continue;
                }

                // Generate embeddings
                let texts: Vec<String> = file_chunks.iter().map(|c| c.content.clone()).collect();
                match state.embedder.embed(texts) {
                    Ok(embeddings) => {
                        // Remove old chunks for this file first
                        let _ = state.store.remove_file(&request.filesystem_hex_id, &relative_path);

                        // Store new chunks with embeddings
                        for (chunk, embedding) in file_chunks.iter().zip(embeddings.iter()) {
                            if let Err(e) = state.store.insert(chunk, embedding) {
                                eprintln!("Failed to insert chunk: {}", e);
                            }
                        }

                        chunks_indexed += file_chunks.len();
                        files_processed += 1;
                    }
                    Err(e) => {
                        eprintln!("Failed to embed file {}: {}", relative_path, e);
                    }
                }
            }
            Err(e) => {
                // Skip binary files or files that can't be read as text
                if e.kind() != std::io::ErrorKind::InvalidData {
                    eprintln!("Failed to read file {}: {}", relative_path, e);
                }
            }
        }
    }

    Ok(IndexResult {
        chunks_indexed,
        files_processed,
    })
}

/// Clear all indexed data for a filesystem hex
#[tauri::command]
pub async fn indexer_clear_filesystem(
    state: State<'_, IndexerState>,
    filesystem_hex_id: String,
) -> Result<usize, String> {
    state.store
        .clear_filesystem(&filesystem_hex_id)
        .map_err(|e| e.to_string())
}
