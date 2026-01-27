/**
 * In-memory work queue for managing work items
 * Replaces PostgreSQL work_items table for local-first architecture
 */

import { WorkItem, WorkItemStatus } from './types';

export class WorkQueue {
  private items: Map<string, WorkItem> = new Map();
  private nextId = 1;

  /**
   * Create a new work item
   */
  create(params: Omit<WorkItem, 'id' | 'createdAt' | 'updatedAt' | 'loopIteration'>): WorkItem {
    const id = `work-${this.nextId++}`;
    const now = new Date();
    
    const workItem: WorkItem = {
      ...params,
      id,
      loopIteration: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.items.set(id, workItem);
    return workItem;
  }

  /**
   * Get a work item by ID
   */
  get(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  /**
   * Update a work item
   */
  update(id: string, updates: Partial<WorkItem>): WorkItem | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;

    const updated = {
      ...item,
      ...updates,
      updatedAt: new Date(),
    };
    this.items.set(id, updated);
    return updated;
  }

  /**
   * Get all work items for a board
   */
  getForBoard(boardId: string): WorkItem[] {
    return Array.from(this.items.values()).filter(item => item.boardId === boardId);
  }

  /**
   * Get all work items for a hex
   */
  getForHex(hexId: string): WorkItem[] {
    return Array.from(this.items.values()).filter(item => item.currentHexId === hexId);
  }

  /**
   * Get work items by status
   */
  getByStatus(boardId: string, status: WorkItemStatus): WorkItem[] {
    return Array.from(this.items.values()).filter(
      item => item.boardId === boardId && item.status === status
    );
  }

  /**
   * Delete a work item
   */
  delete(id: string): boolean {
    return this.items.delete(id);
  }

  /**
   * Clear all work items for a board
   */
  clearBoard(boardId: string): void {
    for (const [id, item] of this.items) {
      if (item.boardId === boardId) {
        this.items.delete(id);
      }
    }
  }

  /**
   * Clear all work items
   */
  clear(): void {
    this.items.clear();
    this.nextId = 1;
  }

  /**
   * Get statistics for a board
   */
  getStats(boardId: string): { total: number; pending: number; processing: number; completed: number; failed: number } {
    const items = this.getForBoard(boardId);
    return {
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      processing: items.filter(i => i.status === 'processing').length,
      completed: items.filter(i => i.status === 'completed').length,
      failed: items.filter(i => i.status === 'failed').length,
    };
  }
}

// Global work queue singleton
export const workQueue = new WorkQueue();

