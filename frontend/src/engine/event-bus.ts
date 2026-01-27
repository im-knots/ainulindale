/**
 * Simple event bus for local execution engine
 * Replaces Redis pub/sub for local-first architecture
 */

import { EngineEvent } from './types';

type EventHandler = (event: EngineEvent) => void;

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private allHandlers: Set<EventHandler> = new Set();

  /**
   * Subscribe to events of a specific type
   */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Subscribe to all events
   */
  onAll(handler: EventHandler): () => void {
    this.allHandlers.add(handler);
    return () => {
      this.allHandlers.delete(handler);
    };
  }

  /**
   * Subscribe to events for a specific hex
   */
  onHex(hexId: string, handler: EventHandler): () => void {
    const wrappedHandler = (event: EngineEvent) => {
      if (event.hexId === hexId) {
        handler(event);
      }
    };
    this.allHandlers.add(wrappedHandler);
    return () => {
      this.allHandlers.delete(wrappedHandler);
    };
  }

  /**
   * Subscribe to events for a specific board
   */
  onBoard(boardId: string, handler: EventHandler): () => void {
    const wrappedHandler = (event: EngineEvent) => {
      if (event.boardId === boardId) {
        handler(event);
      }
    };
    this.allHandlers.add(wrappedHandler);
    return () => {
      this.allHandlers.delete(wrappedHandler);
    };
  }

  /**
   * Emit an event
   */
  emit(event: EngineEvent): void {
    // Log budget events for debugging
    if (event.type === 'budget.exceeded') {
      console.log('[EventBus] Emitting budget.exceeded event', {
        typeHandlers: this.handlers.get(event.type)?.size ?? 0,
        allHandlers: this.allHandlers.size,
        event,
      });
    }

    // Notify type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in event handler for ${event.type}:`, error);
        }
      }
    }

    // Notify all-event handlers
    for (const handler of this.allHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in all-event handler:', error);
      }
    }
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear();
    this.allHandlers.clear();
  }
}

// Global event bus singleton
export const eventBus = new EventBus();

