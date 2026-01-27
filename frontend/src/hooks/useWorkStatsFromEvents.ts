/**
 * useWorkStatsFromEvents Hook
 * 
 * React hook that subscribes directly to EventBus for real-time work statistics.
 * This makes the EventBus the source of truth for live metrics, not Zustand.
 * 
 * Architecture:
 * - EventBus: source of truth for real-time events
 * - SQLite: source of truth for persistence
 * - Zustand: thin wrapper around SQLite for React binding (persistent data only)
 * - This hook: React subscription to EventBus for live UI updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { eventBus } from '../engine/event-bus';
import { EngineEvent } from '../engine/types';

export interface LiveWorkStats {
  activeAgents: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  tasksPerHour: number;
}

const initialStats: LiveWorkStats = {
  activeAgents: 0,
  pendingTasks: 0,
  inProgressTasks: 0,
  completedTasks: 0,
  tasksPerHour: 0,
};

/**
 * Hook that provides live work statistics by subscribing to EventBus events.
 * Resets when board starts, updates on work.received/work.completed events.
 */
export function useWorkStatsFromEvents(): LiveWorkStats {
  const [stats, setStats] = useState<LiveWorkStats>(initialStats);
  
  // Track completion timestamps for tasks/hour calculation
  const completionTimestamps = useRef<number[]>([]);
  const startTime = useRef<number | null>(null);

  // Calculate tasks per hour based on completion rate
  const calculateTasksPerHour = useCallback(() => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    // Filter to completions in the last hour
    completionTimestamps.current = completionTimestamps.current.filter(
      (ts) => ts > oneHourAgo
    );
    
    // If we have a start time less than an hour ago, use that for rate calculation
    if (startTime.current && now - startTime.current < 60 * 60 * 1000) {
      const elapsedHours = (now - startTime.current) / (60 * 60 * 1000);
      if (elapsedHours > 0) {
        return completionTimestamps.current.length / elapsedHours;
      }
    }
    
    return completionTimestamps.current.length;
  }, []);

  useEffect(() => {
    const handleEvent = (event: EngineEvent) => {
      switch (event.type) {
        case 'board.loaded':
          // Reset stats when a new board is loaded
          startTime.current = null;
          completionTimestamps.current = [];
          setStats(initialStats);
          break;

        case 'board.started':
          // Reset stats when board starts
          startTime.current = Date.now();
          completionTimestamps.current = [];
          setStats(initialStats);
          break;

        case 'board.stopped':
          // Reset active agents when board stops
          setStats((prev) => ({
            ...prev,
            activeAgents: 0,
            inProgressTasks: 0,
          }));
          break;

        case 'work.received':
          setStats((prev) => ({
            ...prev,
            inProgressTasks: prev.inProgressTasks + 1,
          }));
          break;

        case 'work.completed':
          completionTimestamps.current.push(Date.now());
          setStats((prev) => ({
            ...prev,
            inProgressTasks: Math.max(0, prev.inProgressTasks - 1),
            completedTasks: prev.completedTasks + 1,
            tasksPerHour: calculateTasksPerHour(),
          }));
          break;

        case 'task.added':
          // Task added to a tasklist - increment pending count
          setStats((prev) => ({
            ...prev,
            pendingTasks: prev.pendingTasks + 1,
          }));
          break;

        case 'task.claimed':
          // Task claimed from tasklist - decrement pending (it's now in progress)
          setStats((prev) => ({
            ...prev,
            pendingTasks: Math.max(0, prev.pendingTasks - 1),
          }));
          break;

        case 'task.completed':
          // Task completed - increment completed count
          completionTimestamps.current.push(Date.now());
          setStats((prev) => ({
            ...prev,
            completedTasks: prev.completedTasks + 1,
            tasksPerHour: calculateTasksPerHour(),
          }));
          break;

        case 'hex.status': {
          // Track active agents based on hex status
          const status = event.data?.status as string | undefined;
          if (status === 'active') {
            setStats((prev) => ({
              ...prev,
              activeAgents: prev.activeAgents + 1,
            }));
          } else if (status === 'idle' || status === 'disabled') {
            setStats((prev) => ({
              ...prev,
              activeAgents: Math.max(0, prev.activeAgents - 1),
            }));
          }
          break;
        }
      }
    };

    // Subscribe to all events
    const cleanup = eventBus.onAll(handleEvent);

    return cleanup;
  }, [calculateTasksPerHour]);

  return stats;
}

export default useWorkStatsFromEvents;

