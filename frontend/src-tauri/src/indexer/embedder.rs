//! Embedding generation using fastembed
//!
//! Provides local embedding generation using the fastembed crate with ONNX Runtime.

use fastembed::{EmbeddingModel, TextInitOptions, TextEmbedding};
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum EmbedderError {
    #[error("Failed to initialize embedding model: {0}")]
    InitError(String),
    #[error("Failed to generate embeddings: {0}")]
    EmbedError(String),
    #[error("Model not initialized")]
    NotInitialized,
}

/// Wrapper around fastembed's TextEmbedding model
pub struct Embedder {
    model: Mutex<Option<TextEmbedding>>,
    cache_dir: Option<PathBuf>,
    embedding_dim: usize,
}

impl Embedder {
    /// Create a new embedder (lazy initialization)
    pub fn new() -> Self {
        Self {
            model: Mutex::new(None),
            cache_dir: None,
            embedding_dim: 384, // AllMiniLML6V2 dimension
        }
    }

    /// Create a new embedder with a custom cache directory for model persistence
    pub fn with_cache_dir(cache_dir: PathBuf) -> Self {
        Self {
            model: Mutex::new(None),
            cache_dir: Some(cache_dir),
            embedding_dim: 384, // AllMiniLML6V2 dimension
        }
    }

    /// Initialize the embedding model
    /// This downloads the model on first use (~80MB) to the cache directory
    pub fn initialize(&self) -> Result<(), EmbedderError> {
        let mut model_guard = self.model.lock().unwrap();
        if model_guard.is_some() {
            return Ok(());
        }

        let mut options = TextInitOptions::new(EmbeddingModel::AllMiniLML6V2)
            .with_show_download_progress(true);

        // Set cache directory if provided for persistent model storage
        if let Some(ref cache_dir) = self.cache_dir {
            options = options.with_cache_dir(cache_dir.clone());
        }

        let model = TextEmbedding::try_new(options)
            .map_err(|e| EmbedderError::InitError(e.to_string()))?;

        *model_guard = Some(model);
        Ok(())
    }

    /// Check if the model is initialized
    pub fn is_initialized(&self) -> bool {
        self.model.lock().unwrap().is_some()
    }

    /// Get the embedding dimension
    pub fn embedding_dim(&self) -> usize {
        self.embedding_dim
    }

    /// Generate embeddings for a batch of texts
    pub fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, EmbedderError> {
        let mut model_guard = self.model.lock().unwrap();
        let model = model_guard
            .as_mut()
            .ok_or(EmbedderError::NotInitialized)?;

        // Convert Vec<String> to Vec<&str> for fastembed
        let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();

        model
            .embed(text_refs, None)
            .map_err(|e| EmbedderError::EmbedError(e.to_string()))
    }

    /// Generate embedding for a single text
    pub fn embed_one(&self, text: &str) -> Result<Vec<f32>, EmbedderError> {
        let embeddings = self.embed(vec![text.to_string()])?;
        embeddings
            .into_iter()
            .next()
            .ok_or_else(|| EmbedderError::EmbedError("No embedding returned".to_string()))
    }

    /// Generate embeddings with progress callback
    pub fn embed_with_progress<F>(
        &self,
        texts: Vec<String>,
        batch_size: usize,
        mut on_progress: F,
    ) -> Result<Vec<Vec<f32>>, EmbedderError>
    where
        F: FnMut(usize, usize),
    {
        let total = texts.len();
        let mut all_embeddings = Vec::with_capacity(total);

        for (batch_idx, batch) in texts.chunks(batch_size).enumerate() {
            let batch_embeddings = self.embed(batch.to_vec())?;
            all_embeddings.extend(batch_embeddings);
            
            let processed = ((batch_idx + 1) * batch_size).min(total);
            on_progress(processed, total);
        }

        Ok(all_embeddings)
    }
}

impl Default for Embedder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedder_creation() {
        let embedder = Embedder::new();
        assert!(!embedder.is_initialized());
        assert_eq!(embedder.embedding_dim(), 384);
    }
}

