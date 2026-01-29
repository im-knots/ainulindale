/**
 * Indexer Service - Manages codebase indexing for RAG-based search
 * 
 * Handles automatic indexing triggers:
 * 1. On board start - index all filesystem hexes
 * 2. On file changes - incremental updates
 * 3. On filesystem hex config change - re-index with new path
 */

import { EventBus } from './event-bus';
import { Store, ToolEntity } from '../state/store';

interface IndexDirectoryRequest {
  filesystem_hex_id: string;
  directory_path: string;
}

interface IndexFileRequest {
  filesystem_hex_id: string;
  base_path: string;
  file_path: string;
}

interface IndexResult {
  chunks_indexed: number;
  files_processed: number;
}



export class IndexerService {
  private eventBus: EventBus;
  private store: Store;
  private unsubscribeFilesystemChanged?: () => void;
  private unsubscribeEntityUpdated?: () => void;
  private indexedFilesystems: Map<string, string> = new Map(); // entityId -> rootPath

  constructor(eventBus: EventBus, store: Store) {
    this.eventBus = eventBus;
    this.store = store;
  }

  /**
   * Start the indexer service - subscribe to events and index all filesystem hexes
   */
  async start(): Promise<void> {
    console.log('[IndexerService] Starting...');

    // Subscribe to filesystem.changed events for incremental updates
    this.unsubscribeFilesystemChanged = this.eventBus.on('filesystem.changed', (event) => {
      this.handleFilesystemChanged(event);
    });

    // Subscribe to entity.updated events for config changes
    this.unsubscribeEntityUpdated = this.eventBus.on('entity.updated', (event) => {
      this.handleEntityUpdated(event);
    });

    // Initialize the indexer (downloads model if needed)
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('indexer_initialize');
      console.log('[IndexerService] Indexer initialized');
    } catch (error) {
      console.error('[IndexerService] Failed to initialize indexer:', error);
      return;
    }

    // Index all filesystem hexes
    await this.indexAllFilesystemHexes();
  }

  /**
   * Stop the indexer service
   */
  stop(): void {
    console.log('[IndexerService] Stopping...');
    
    if (this.unsubscribeFilesystemChanged) {
      this.unsubscribeFilesystemChanged();
      this.unsubscribeFilesystemChanged = undefined;
    }
    
    if (this.unsubscribeEntityUpdated) {
      this.unsubscribeEntityUpdated();
      this.unsubscribeEntityUpdated = undefined;
    }

    this.indexedFilesystems.clear();
  }

  /**
   * Index all filesystem hexes on the board
   */
  async indexAllFilesystemHexes(): Promise<void> {
    const state = this.store.getState();
    const entities = Array.from(state.entities.values());

    const filesystemEntities = entities.filter(
      (e): e is ToolEntity => 
        e.category === 'tool' && 
        (e as ToolEntity).toolType === 'filesystem'
    );

    console.log(`[IndexerService] Found ${filesystemEntities.length} filesystem hexes to index`);

    for (const entity of filesystemEntities) {
      await this.indexFilesystemHex(entity);
    }
  }

  /**
   * Index a single filesystem hex
   */
  async indexFilesystemHex(entity: ToolEntity): Promise<void> {
    const config = entity.config as { rootPath?: string };
    const rootPath = config.rootPath;

    if (!rootPath || rootPath.trim() === '') {
      console.log(`[IndexerService] Skipping ${entity.name} - no rootPath configured`);
      return;
    }

    // Check if already indexed with same path
    if (this.indexedFilesystems.get(entity.id) === rootPath) {
      console.log(`[IndexerService] Skipping ${entity.name} - already indexed`);
      return;
    }

    console.log(`[IndexerService] Indexing ${entity.name} at ${rootPath}...`);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      
      const request: IndexDirectoryRequest = {
        filesystem_hex_id: entity.id,
        directory_path: rootPath,
      };

      const result = await invoke<IndexResult>('indexer_index_directory', { request });
      
      this.indexedFilesystems.set(entity.id, rootPath);
      console.log(
        `[IndexerService] Indexed ${entity.name}: ${result.files_processed} files, ${result.chunks_indexed} chunks`
      );
    } catch (error) {
      console.error(`[IndexerService] Failed to index ${entity.name}:`, error);
    }
  }

  /**
   * Handle filesystem.changed event for incremental index updates
   */
  private async handleFilesystemChanged(event: { hexId: string; data: Record<string, unknown> }): Promise<void> {
    const filesystemHexId = event.hexId;
    const { operation, path: filePath } = event.data as {
      operation: string;
      path?: string;
      sourcePath?: string;
      destinationPath?: string;
    };

    // Get the rootPath for this filesystem hex
    const rootPath = this.indexedFilesystems.get(filesystemHexId);
    if (!rootPath) {
      // This filesystem isn't indexed yet, skip
      return;
    }

    const targetPath = filePath || (event.data.destinationPath as string);
    if (!targetPath) {
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      if (operation === 'write' || operation === 'create') {
        // Re-index the file
        const request: IndexFileRequest = {
          filesystem_hex_id: filesystemHexId,
          base_path: rootPath,
          file_path: targetPath,
        };

        const chunks = await invoke<number>('indexer_index_file', { request });
        console.log(`[IndexerService] Re-indexed ${targetPath}: ${chunks} chunks`);
      } else if (operation === 'delete') {
        // Remove from index
        const removed = await invoke<number>('indexer_remove_file', {
          filesystem_hex_id: filesystemHexId,
          file_path: targetPath,
        });
        console.log(`[IndexerService] Removed ${targetPath} from index: ${removed} chunks`);
      } else if (operation === 'move' || operation === 'copy') {
        // For move: remove old path, index new path
        const sourcePath = event.data.sourcePath as string;
        const destPath = event.data.destinationPath as string;

        if (operation === 'move' && sourcePath) {
          await invoke('indexer_remove_file', {
            filesystem_hex_id: filesystemHexId,
            file_path: sourcePath,
          });
        }

        if (destPath) {
          const request: IndexFileRequest = {
            filesystem_hex_id: filesystemHexId,
            base_path: rootPath,
            file_path: destPath,
          };
          await invoke('indexer_index_file', { request });
        }
        console.log(`[IndexerService] Handled ${operation}: ${sourcePath} -> ${destPath}`);
      }
    } catch (error) {
      console.error(`[IndexerService] Failed to update index for ${targetPath}:`, error);
    }
  }

  /**
   * Handle entity.updated event for config changes (e.g., rootPath change)
   */
  private async handleEntityUpdated(event: { hexId: string; data: Record<string, unknown> }): Promise<void> {
    const entityId = event.data.entityId as string;
    const category = event.data.category as string;

    if (category !== 'tool') {
      return;
    }

    // Get the entity to check if it's a filesystem tool
    const state = this.store.getState();
    const entity = state.entities.get(entityId);

    if (!entity || entity.category !== 'tool') {
      return;
    }

    const toolEntity = entity as ToolEntity;
    if (toolEntity.toolType !== 'filesystem') {
      return;
    }

    const config = toolEntity.config as { rootPath?: string };
    const newRootPath = config.rootPath;
    const oldRootPath = this.indexedFilesystems.get(entityId);

    // Check if rootPath changed
    if (newRootPath !== oldRootPath) {
      console.log(`[IndexerService] Filesystem ${toolEntity.name} rootPath changed: ${oldRootPath} -> ${newRootPath}`);

      try {
        const { invoke } = await import('@tauri-apps/api/core');

        // Clear old index
        if (oldRootPath) {
          await invoke('indexer_clear_filesystem', { filesystem_hex_id: entityId });
          console.log(`[IndexerService] Cleared old index for ${toolEntity.name}`);
        }

        // Remove from tracked filesystems
        this.indexedFilesystems.delete(entityId);

        // Re-index with new path
        if (newRootPath && newRootPath.trim() !== '') {
          await this.indexFilesystemHex(toolEntity);
        }
      } catch (error) {
        console.error(`[IndexerService] Failed to re-index ${toolEntity.name}:`, error);
      }
    }
  }
}

