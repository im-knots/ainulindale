/**
 * Change Tracker - Tracks recent filesystem changes across all agents
 *
 * Maintains a rolling list of recent file modifications so agents can be
 * aware of what other agents have changed. This context is injected into
 * agent prompts to improve coordination.
 *
 * Features:
 * - Track recent file changes with agent attribution
 * - Auto-prune old changes
 * - Format changes for prompt injection
 */

import { EventBus } from '../event-bus';
import { EngineEvent } from '../types';

export interface FileChange {
  agentId: string;
  agentName: string;
  agentTemplate: string;
  filePath: string;
  operation: string;
  timestamp: Date;
  filesystemHexId: string;
}

// Maximum number of changes to keep
const MAX_CHANGES = 30;
// Maximum age of changes to keep (10 minutes)
const MAX_CHANGE_AGE_MS = 10 * 60 * 1000;

class ChangeTracker {
  private changes: FileChange[] = [];
  private unsubscribe: (() => void) | null = null;

  /**
   * Start listening to filesystem.changed events from the EventBus
   */
  subscribe(eventBus: EventBus): void {
    if (this.unsubscribe) {
      return; // Already subscribed
    }

    this.unsubscribe = eventBus.on('filesystem.changed', (event: EngineEvent) => {
      this.recordChange(event);
    });
    console.log('[ChangeTracker] Subscribed to filesystem.changed events');
  }

  /**
   * Stop listening to events
   */
  unsubscribeAll(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      console.log('[ChangeTracker] Unsubscribed from events');
    }
  }

  /**
   * Record a filesystem change from an event
   */
  private recordChange(event: EngineEvent): void {
    const { data } = event;
    
    // Extract the path from the event data
    const filePath = (data.path as string) || 
                     (data.destinationPath as string) || 
                     (data.sourcePath as string) || 
                     'unknown';

    const change: FileChange = {
      agentId: data.changedBy as string,
      agentName: (data.changedByName as string) || 'Unknown Agent',
      agentTemplate: (data.changedByTemplate as string) || 'agent',
      filePath,
      operation: data.operation as string,
      timestamp: event.timestamp,
      filesystemHexId: event.hexId,
    };

    this.changes.push(change);
    this.pruneOldChanges();
    
    console.log(`[ChangeTracker] Recorded: ${change.agentName} ${change.operation} ${change.filePath}`);
  }

  /**
   * Manually add a change (for direct integration without events)
   */
  addChange(change: Omit<FileChange, 'timestamp'>): void {
    this.changes.push({
      ...change,
      timestamp: new Date(),
    });
    this.pruneOldChanges();
  }

  /**
   * Remove changes that are too old or exceed the max count
   */
  private pruneOldChanges(): void {
    const now = Date.now();
    
    // Filter out old changes
    this.changes = this.changes.filter(
      change => now - change.timestamp.getTime() < MAX_CHANGE_AGE_MS
    );

    // Keep only the most recent if we have too many
    if (this.changes.length > MAX_CHANGES) {
      this.changes = this.changes.slice(-MAX_CHANGES);
    }
  }

  /**
   * Get recent changes, optionally filtered by filesystem hex(es)
   * Excludes changes made by the requesting agent
   *
   * @param excludeAgentId - Agent ID to exclude from results (usually the requesting agent)
   * @param accessibleFilesystemIds - Array of filesystem hex IDs the agent can access
   *                                  If provided, only changes from these filesystems are returned
   */
  getRecentChanges(excludeAgentId?: string, accessibleFilesystemIds?: string[]): FileChange[] {
    this.pruneOldChanges();

    return this.changes.filter(change => {
      if (excludeAgentId && change.agentId === excludeAgentId) {
        return false;
      }
      // If we have a list of accessible filesystems, only include changes from those
      if (accessibleFilesystemIds && accessibleFilesystemIds.length > 0) {
        if (!accessibleFilesystemIds.includes(change.filesystemHexId)) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Format recent changes for injection into agent prompts
   *
   * @param excludeAgentId - Agent ID to exclude from results (usually the requesting agent)
   * @param accessibleFilesystemIds - Array of filesystem hex IDs the agent can access
   *                                  If provided, only changes from these filesystems are shown
   */
  formatForPrompt(excludeAgentId?: string, accessibleFilesystemIds?: string[]): string | null {
    const changes = this.getRecentChanges(excludeAgentId, accessibleFilesystemIds);

    if (changes.length === 0) {
      return null;
    }

    const now = Date.now();
    const lines = changes.map(change => {
      const ageMs = now - change.timestamp.getTime();
      const ageStr = formatAge(ageMs);
      // Format: "- src/utils.ts: written by coder <abc123> (2m ago)"
      const shortId = change.agentId.substring(0, 8);
      const agentIdentifier = `${change.agentTemplate} <${shortId}>`;
      return `- ${change.filePath}: ${change.operation} by ${agentIdentifier} (${ageStr})`;
    });

    return `## Recent Filesystem Changes

Other agents have recently modified files in your workspace:
${lines.join('\n')}

Consider these changes when planning your work to avoid conflicts.`;
  }

  /**
   * Clear all tracked changes (useful for board stop/reset)
   */
  clearAll(): void {
    console.log(`[ChangeTracker] Clearing all changes (${this.changes.length} changes)`);
    this.changes = [];
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
export const changeTracker = new ChangeTracker();

