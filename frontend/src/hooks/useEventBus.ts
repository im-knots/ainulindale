/**
 * useEventBus Hook
 * React hook for subscribing to engine events with automatic cleanup
 */

import { useEffect, useCallback, useRef } from 'react';
import { eventBus } from '../engine/event-bus';
import { EngineEvent } from '../engine/types';

type EventHandler = (event: EngineEvent) => void;

/**
 * Subscribe to a specific event type
 */
export function useEventBusOn(eventType: string, handler: EventHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrappedHandler = (event: EngineEvent) => {
      handlerRef.current(event);
    };
    return eventBus.on(eventType, wrappedHandler);
  }, [eventType]);
}

/**
 * Subscribe to all events
 */
export function useEventBusAll(handler: EventHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrappedHandler = (event: EngineEvent) => {
      handlerRef.current(event);
    };
    return eventBus.onAll(wrappedHandler);
  }, []);
}

/**
 * Subscribe to events for a specific hex
 */
export function useEventBusHex(hexId: string | null, handler: EventHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!hexId) return;
    const wrappedHandler = (event: EngineEvent) => {
      handlerRef.current(event);
    };
    return eventBus.onHex(hexId, wrappedHandler);
  }, [hexId]);
}

/**
 * Subscribe to events for a specific board
 */
export function useEventBusBoard(boardId: string | null, handler: EventHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!boardId) return;
    const wrappedHandler = (event: EngineEvent) => {
      handlerRef.current(event);
    };
    return eventBus.onBoard(boardId, wrappedHandler);
  }, [boardId]);
}

/**
 * Get a stable emit function
 */
export function useEventBusEmit() {
  return useCallback((event: EngineEvent) => {
    eventBus.emit(event);
  }, []);
}

/**
 * Combined hook for common patterns
 */
export function useEventBus() {
  const emit = useEventBusEmit();

  const on = useCallback((eventType: string, handler: EventHandler) => {
    return eventBus.on(eventType, handler);
  }, []);

  const onAll = useCallback((handler: EventHandler) => {
    return eventBus.onAll(handler);
  }, []);

  const onHex = useCallback((hexId: string, handler: EventHandler) => {
    return eventBus.onHex(hexId, handler);
  }, []);

  const onBoard = useCallback((boardId: string, handler: EventHandler) => {
    return eventBus.onBoard(boardId, handler);
  }, []);

  return { emit, on, onAll, onHex, onBoard };
}

export default useEventBus;

