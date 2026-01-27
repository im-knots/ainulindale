/**
 * Filesystem Context Manager - Per-filesystem-hex context tracking for agents
 *
 * Tracks read operations per agent per filesystem hex, enabling:
 * - Read-before-write enforcement: Agents must read a file before writing to it
 * - Staleness detection: Detect when files have been modified since last read
 * - File mtime tracking: Know when files were last read by each agent
 *
 * Key concepts:
 * - Each filesystem hex has its own isolated context
 * - Agents track their own read history per filesystem hex
 * - Changes from other agents can invalidate cached reads
 */

import { EventBus } from '../event-bus';
import { EngineEvent } from '../types';

/**
 * Record of a file read operation by an agent
 */
export interface FileReadRecord {
  agentId: string;
  filesystemHexId: string;
  filePath: string;
  // Modification time when the file was read (from Tauri stat)
  readMtime: number;
  // Timestamp when the read occurred
  readTimestamp: Date;
  // Optional content hash for detecting changes even with same mtime
  contentHash?: string;
}

/**
 * Staleness check result
 */
export interface StalenessResult {
  isStale: boolean;
  filePath: string;
  filesystemHexId: string;
  readMtime: number;
  currentMtime: number;
  modifiedBy?: string;
  modifiedByName?: string;
}

/**
 * Read-before-write check result
 */
export interface ReadBeforeWriteResult {
  allowed: boolean;
  filePath: string;
  filesystemHexId: string;
  reason?: string;
}

/**
 * Manages filesystem context per agent per filesystem hex
 */
class FilesystemContextManager {
  // Map: filesystemHexId -> Map: agentId -> Map: filePath -> FileReadRecord
  private readRecords: Map<string, Map<string, Map<string, FileReadRecord>>> = new Map();

  // Map: filesystemHexId -> Map: filePath -> { mtime, changedBy, changedByName }
  // Tracks known file modifications for staleness comparison
  private knownModifications: Map<string, Map<string, { mtime: number; changedBy: string; changedByName: string }>> = new Map();

  private unsubscribe: (() => void) | null = null;

  /**
   * Subscribe to filesystem.changed events to track modifications
   */
  subscribe(eventBus: EventBus): void {
    if (this.unsubscribe) {
      return; // Already subscribed
    }

    this.unsubscribe = eventBus.on('filesystem.changed', (event: EngineEvent) => {
      this.handleFilesystemChanged(event);
    });
    console.log('[FilesystemContextManager] Subscribed to filesystem.changed events');
  }

  /**
   * Stop listening to events
   */
  unsubscribeAll(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      console.log('[FilesystemContextManager] Unsubscribed from events');
    }
  }

  /**
   * Handle a filesystem change event - record the modification for staleness detection
   */
  private handleFilesystemChanged(event: EngineEvent): void {
    const filesystemHexId = event.hexId;
    const { data } = event;

    const filePath = (data.path as string) ||
                     (data.destinationPath as string) ||
                     (data.sourcePath as string);

    if (!filePath) return;

    // Record this modification
    if (!this.knownModifications.has(filesystemHexId)) {
      this.knownModifications.set(filesystemHexId, new Map());
    }

    const fsModifications = this.knownModifications.get(filesystemHexId)!;
    fsModifications.set(filePath, {
      mtime: Date.now(), // Use current time as approximate mtime
      changedBy: data.changedBy as string,
      changedByName: (data.changedByName as string) || 'Unknown Agent',
    });

    console.log(`[FilesystemContextManager] Recorded modification: ${filePath} by ${data.changedByName}`);
  }

  /**
   * Record that an agent read a file from a specific filesystem hex
   */
  recordRead(
    agentId: string,
    filesystemHexId: string,
    filePath: string,
    mtime: number,
    contentHash?: string
  ): void {
    // Initialize nested maps if needed
    if (!this.readRecords.has(filesystemHexId)) {
      this.readRecords.set(filesystemHexId, new Map());
    }
    const fsRecords = this.readRecords.get(filesystemHexId)!;

    if (!fsRecords.has(agentId)) {
      fsRecords.set(agentId, new Map());
    }
    const agentRecords = fsRecords.get(agentId)!;

    const record: FileReadRecord = {
      agentId,
      filesystemHexId,
      filePath,
      readMtime: mtime,
      readTimestamp: new Date(),
      contentHash,
    };

    agentRecords.set(filePath, record);
    console.log(`[FilesystemContextManager] Recorded read: ${agentId} read ${filePath} from ${filesystemHexId}`);
  }

  /**
   * Check if an agent has read a file from a specific filesystem hex
   */
  hasRead(agentId: string, filesystemHexId: string, filePath: string): boolean {
    const fsRecords = this.readRecords.get(filesystemHexId);
    if (!fsRecords) return false;

    const agentRecords = fsRecords.get(agentId);
    if (!agentRecords) return false;

    return agentRecords.has(filePath);
  }

  /**
   * Get the read record for a specific file
   */
  getReadRecord(agentId: string, filesystemHexId: string, filePath: string): FileReadRecord | null {
    const fsRecords = this.readRecords.get(filesystemHexId);
    if (!fsRecords) return null;

    const agentRecords = fsRecords.get(agentId);
    if (!agentRecords) return null;

    return agentRecords.get(filePath) || null;
  }

  /**
   * Get all files an agent has read from a specific filesystem hex
   */
  getAgentReads(agentId: string, filesystemHexId: string): FileReadRecord[] {
    const fsRecords = this.readRecords.get(filesystemHexId);
    if (!fsRecords) return [];

    const agentRecords = fsRecords.get(agentId);
    if (!agentRecords) return [];

    return Array.from(agentRecords.values());
  }

  /**
   * Check read-before-write: Has the agent read this file before attempting to write?
   *
   * @param agentId - The agent attempting to write
   * @param filesystemHexId - The filesystem hex the agent is writing through
   * @param filePath - The file path being written to
   * @param fileExists - Whether the file currently exists. If false (new file), write is allowed without prior read.
   */
  checkReadBeforeWrite(
    agentId: string,
    filesystemHexId: string,
    filePath: string,
    fileExists: boolean = true
  ): ReadBeforeWriteResult {
    // Allow writes to new files - no need to read a file that doesn't exist yet
    if (!fileExists) {
      return {
        allowed: true,
        filePath,
        filesystemHexId,
      };
    }

    // For existing files, enforce read-before-write
    const hasReadFile = this.hasRead(agentId, filesystemHexId, filePath);

    if (!hasReadFile) {
      return {
        allowed: false,
        filePath,
        filesystemHexId,
        reason: `You must read "${filePath}" before writing to it. Use read_file to understand the current content first.`,
      };
    }

    return {
      allowed: true,
      filePath,
      filesystemHexId,
    };
  }

  /**
   * Check if a file is stale (modified since the agent last read it)
   * Uses the modification events we've recorded
   */
  checkStaleness(
    agentId: string,
    filesystemHexId: string,
    filePath: string
  ): StalenessResult | null {
    const readRecord = this.getReadRecord(agentId, filesystemHexId, filePath);
    if (!readRecord) {
      return null; // No read record, can't check staleness
    }

    // Check if we have a known modification after the read
    const fsModifications = this.knownModifications.get(filesystemHexId);
    if (!fsModifications) {
      return null; // No known modifications
    }

    const modification = fsModifications.get(filePath);
    if (!modification) {
      return null; // This file wasn't modified
    }

    // Check if modification happened after the read
    if (modification.mtime > readRecord.readTimestamp.getTime()) {
      // Don't count own modifications as stale
      if (modification.changedBy === agentId) {
        return null;
      }

      return {
        isStale: true,
        filePath,
        filesystemHexId,
        readMtime: readRecord.readMtime,
        currentMtime: modification.mtime,
        modifiedBy: modification.changedBy,
        modifiedByName: modification.changedByName,
      };
    }

    return null;
  }

  /**
   * Get all stale files for an agent on a specific filesystem hex
   */
  getStaleFiles(agentId: string, filesystemHexId: string): StalenessResult[] {
    const staleFiles: StalenessResult[] = [];
    const agentReads = this.getAgentReads(agentId, filesystemHexId);

    for (const record of agentReads) {
      const staleness = this.checkStaleness(agentId, filesystemHexId, record.filePath);
      if (staleness) {
        staleFiles.push(staleness);
      }
    }

    return staleFiles;
  }

  /**
   * Get all stale files across all filesystem hexes the agent has read from
   */
  getAllStaleFiles(agentId: string): StalenessResult[] {
    const allStaleFiles: StalenessResult[] = [];

    for (const [filesystemHexId] of this.readRecords) {
      const staleFiles = this.getStaleFiles(agentId, filesystemHexId);
      allStaleFiles.push(...staleFiles);
    }

    return allStaleFiles;
  }

  /**
   * Format stale files for prompt injection
   */
  formatStaleFilesForPrompt(agentId: string): string | null {
    const staleFiles = this.getAllStaleFiles(agentId);

    if (staleFiles.length === 0) {
      return null;
    }

    const lines = staleFiles.map(sf => {
      const ago = formatAge(Date.now() - sf.currentMtime);
      return `- ${sf.filePath}: modified by ${sf.modifiedByName || 'another agent'} (${ago})`;
    });

    return `## Stale File Warning

The following files you previously read have been modified by other agents:
${lines.join('\n')}

You should re-read these files before making changes to avoid conflicts.`;
  }

  /**
   * Clear all records for a specific agent (e.g., when agent stops)
   */
  clearAgentRecords(agentId: string): void {
    for (const [, fsRecords] of this.readRecords) {
      fsRecords.delete(agentId);
    }
    console.log(`[FilesystemContextManager] Cleared records for agent: ${agentId}`);
  }

  /**
   * Clear all records (e.g., when board stops)
   */
  clearAll(): void {
    this.readRecords.clear();
    this.knownModifications.clear();
    console.log('[FilesystemContextManager] Cleared all records');
  }
}

/**
 * Format milliseconds as a human-readable age string
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Singleton instance
export const filesystemContextManager = new FilesystemContextManager();

