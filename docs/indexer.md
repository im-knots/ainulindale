# Codebase Indexer and RAG System

The codebase indexer provides **semantic code search** for agents using Retrieval Augmented Generation (RAG). Instead of keyword matching, agents can search codebases using natural language queries like "authentication middleware" or "database connection handling" and find relevant code.

This is a core capability that enables agents to understand and navigate large codebases without needing to read every file.

## Why RAG for Code Search

Traditional code search relies on exact text matching or regex patterns. This fails when:

- You don't know the exact function name
- Code uses different terminology than your query
- You're looking for conceptual patterns, not specific strings

RAG-based search understands the **meaning** of code. A query for "error handling" finds try/catch blocks, Result types, error logging, and exception handlers - even if none of them contain the literal words "error handling".

## How It Works

The indexer runs entirely locally using a Rust backend with three main components:

### 1. Code Chunking

Source files are split into meaningful chunks for embedding. The chunker uses two strategies:

**Tree-Sitter Parsing** (for supported languages):
- Parses code into an Abstract Syntax Tree (AST)
- Extracts complete semantic units (functions, classes, structs, etc.)
- Preserves code structure and context
- Each chunk represents a complete, meaningful code unit

**Line-Based Fallback** (for other files):
- Splits files into overlapping chunks of configurable size
- Overlap ensures context isn't lost at chunk boundaries
- Works for any text file (configs, docs, etc.)

### 2. Embedding Generation

Each chunk is converted to a vector embedding using a local AI model:

- **Model**: All-MiniLM-L6-v2 (384-dimensional embeddings)
- **Runtime**: ONNX Runtime for fast local inference
- **No API calls**: Everything runs on your machine
- **First-run download**: Model (~80MB) is downloaded once and cached

### 3. Vector Storage

Embeddings are stored in SQLite with the sqlite-vec extension:

- **Per-hex isolation**: Each filesystem hex has its own index partition
- **KNN search**: Fast k-nearest-neighbor queries for similarity matching
- **Persistent storage**: Index survives app restarts
- **Incremental updates**: Only changed files are re-indexed

## Automatic Indexing Triggers

Indexing happens automatically at three points:

| Trigger | What Happens |
|---------|--------------|
| **Board Start** | All filesystem hexes with a configured root path are fully indexed |
| **File Changes** | When agents write, create, or delete files, the index updates incrementally |
| **Config Changes** | When a filesystem hex's root path changes, the old index is cleared and the new path is indexed |

The IndexerService subscribes to `filesystem.changed` events and updates the index in real-time as agents modify files.

## How Agents Use It

Agents with `execute` permission on a filesystem hex can search the indexed codebase using the `codebase_search` tool:

| Query | What It Finds |
|-------|---------------|
| "user authentication" | Login functions, auth middleware, session handling |
| "database connection" | DB initialization, connection pools, query builders |
| "error handling" | Try/catch blocks, error types, logging utilities |
| "API endpoints" | Route handlers, controllers, request validators |

### Search Results

Each result includes:

| Field | Description |
|-------|-------------|
| **file_path** | Path to the source file |
| **start_line** | First line of the matching chunk |
| **end_line** | Last line of the matching chunk |
| **content** | The actual code content |
| **language** | Detected programming language |
| **score** | Similarity score (higher = more relevant) |

Results are ranked by semantic similarity to the query, with the most relevant chunks first.

## Tree-Sitter Syntax-Aware Chunking

For supported languages, the indexer uses tree-sitter to extract complete semantic units:

### Supported Languages

| Language | Extensions | Semantic Units Extracted |
|----------|------------|--------------------------|
| **Rust** | `.rs` | Functions, impl blocks, structs, enums, traits, modules, macros |
| **TypeScript** | `.ts`, `.tsx` | Functions, classes, interfaces, type aliases, enums, exports |
| **JavaScript** | `.js`, `.jsx`, `.mjs` | Functions, classes, exports, variable declarations |
| **Python** | `.py` | Functions, classes, decorated definitions |
| **Go** | `.go` | Functions, methods, type declarations, const/var declarations |

### Why Syntax-Aware Chunking Matters

Line-based chunking can split a function in the middle, losing context. Tree-sitter ensures:

- **Complete units**: A function is never split across chunks
- **Meaningful boundaries**: Chunks align with code structure
- **Better embeddings**: Complete code units produce more accurate semantic vectors
- **Accurate line numbers**: Results point to exact function/class locations

### Large Code Units

When a function or class exceeds the maximum chunk size (default: 100 lines):

1. The unit is split into overlapping sub-chunks
2. Overlap (default: 10 lines) preserves context at boundaries
3. Each sub-chunk still references the original file and line numbers

## Ignored Directories

The following directories are automatically skipped during indexing:

- **Package managers**: `node_modules`, `vendor`
- **Build outputs**: `target`, `dist`, `build`
- **Version control**: `.git`
- **Virtual environments**: `.venv`, `venv`, `__pycache__`
- **IDE configs**: `.idea`, `.vscode`

## Performance Characteristics

The indexer is designed for local-first operation:

| Aspect | Behavior |
|--------|----------|
| **Embedding generation** | Runs locally via ONNX Runtime (no API calls) |
| **Model caching** | Downloaded once (~80MB), cached for future use |
| **Per-hex isolation** | Each filesystem hex maintains its own index partition |
| **Incremental updates** | Only changed files are re-indexed |
| **Batch processing** | Files are processed in batches with progress callbacks |
| **Parallel-safe** | Multiple agents can search simultaneously |

### First-Run Behavior

On first board start, the embedding model is downloaded and initialized. This may take a few seconds. Subsequent starts are instant as the model is cached.

## RBAC Integration

Codebase search respects the RBAC permission system:

| Permission | Access |
|------------|--------|
| **Execute** | Can search the codebase index |
| **Read** | Can read specific files, but cannot search |
| **Write** | Can modify files (triggers re-indexing) |

Each filesystem hex's index is isolated - agents can only search hexes they have RBAC access to. This enables scenarios where different agents have access to different parts of the codebase.

## Multi-Hex Search

When an agent has access to multiple filesystem hexes, it can search across all of them in a single query. The search aggregates results from all accessible indexes and ranks them by relevance.

This enables workflows where:
- Different filesystem hexes point to different repositories
- Agents can find related code across multiple codebases
- Results are unified and ranked by semantic similarity

