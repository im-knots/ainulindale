-- Hex Agent SQLite Schema

-- Boards table
-- Budget naming convention:
--   max_dollars / max_tokens = budget limits
--   total_dollars / total_tokens = persistent totals since board creation (survives agent removal)
CREATE TABLE IF NOT EXISTS boards (
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

-- Hex entities table
CREATE TABLE IF NOT EXISTS hex_entities (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    position_q INTEGER NOT NULL,
    position_r INTEGER NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    UNIQUE(board_id, position_q, position_r)
);

-- Connections between hexes
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    from_hex_id TEXT NOT NULL,
    to_hex_id TEXT NOT NULL,
    connection_type TEXT NOT NULL DEFAULT 'flow',
    created_at TEXT NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    FOREIGN KEY (from_hex_id) REFERENCES hex_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (to_hex_id) REFERENCES hex_entities(id) ON DELETE CASCADE
);

-- Settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Work items / execution logs
CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    source_hex_id TEXT,
    current_hex_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

-- Hex execution logs (for bottom bar display)
CREATE TABLE IF NOT EXISTS hex_logs (
    id TEXT PRIMARY KEY,
    hex_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    log_type TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (hex_id) REFERENCES hex_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_hex_entities_board ON hex_entities(board_id);
CREATE INDEX IF NOT EXISTS idx_connections_board ON connections(board_id);
CREATE INDEX IF NOT EXISTS idx_work_items_board ON work_items(board_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_hex_logs_hex ON hex_logs(hex_id);
CREATE INDEX IF NOT EXISTS idx_hex_logs_board ON hex_logs(board_id);

