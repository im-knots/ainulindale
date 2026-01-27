mod commands;
mod database;
mod db_commands;
mod indexer;

use database::Database;
use indexer::commands::IndexerState;
use indexer::embedder::Embedder;
use indexer::store::VectorStore;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize SQLite database
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");
            let db = Database::new(app_data_dir.clone())
                .expect("Failed to initialize database");
            app.manage(db);

            // Initialize indexer with persistent cache for model files
            let model_cache_dir = app_data_dir.join("models");
            std::fs::create_dir_all(&model_cache_dir)
                .expect("Failed to create model cache directory");
            let embedder = Arc::new(Embedder::with_cache_dir(model_cache_dir));
            let store = Arc::new(VectorStore::new(384)); // AllMiniLML6V2 dimension

            // Initialize vector store with database in app data dir
            let indexer_db_path = app_data_dir.join("indexer.db");
            store.initialize(indexer_db_path)
                .expect("Failed to initialize vector store");

            let indexer_state = IndexerState {
                embedder,
                store,
                config: indexer::IndexerConfig::default(),
            };
            app.manage(indexer_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Shell/File commands
            commands::execute_shell,
            commands::read_file,
            commands::write_file,
            commands::list_directory,
            commands::file_exists,
            commands::delete_file,
            commands::delete_directory,
            commands::copy_file,
            commands::move_file,
            commands::create_directory,
            commands::get_file_info,
            commands::get_system_info,
            // Database commands
            db_commands::db_create_board,
            db_commands::db_list_boards,
            db_commands::db_get_board,
            db_commands::db_update_board,
            db_commands::db_delete_board,
            db_commands::db_add_board_usage,
            db_commands::db_reset_board_usage,
            db_commands::db_create_hex,
            db_commands::db_list_hexes,
            db_commands::db_get_hex,
            db_commands::db_update_hex,
            db_commands::db_delete_hex,
            db_commands::db_create_connection,
            db_commands::db_list_connections,
            db_commands::db_delete_connection,
            // Settings commands
            db_commands::db_get_setting,
            db_commands::db_set_setting,
            db_commands::db_delete_setting,
            db_commands::db_list_settings,
            // Indexer commands
            indexer::commands::indexer_initialize,
            indexer::commands::indexer_is_ready,
            indexer::commands::indexer_index_file,
            indexer::commands::indexer_index_directory,
            indexer::commands::indexer_search,
            indexer::commands::indexer_remove_file,
            indexer::commands::indexer_clear_filesystem,
            indexer::commands::indexer_get_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
