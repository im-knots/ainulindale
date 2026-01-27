/**
 * NotificationContainer
 * Displays notifications on the left side of the screen under the top bar
 */

import { useState, useEffect, useCallback } from 'react';
import { eventBus } from '../../engine/event-bus';
import type { EngineEvent } from '../../engine/types';

export interface Notification {
  id: string;
  type: 'warning' | 'error' | 'info' | 'success';
  title: string;
  message: string;
  timestamp: Date;
  autoDismiss?: boolean;
  dismissAfter?: number; // ms
}

// Global notification state for external access
let addNotificationExternal: ((notification: Omit<Notification, 'id' | 'timestamp'>) => void) | null = null;

export function addNotification(notification: Omit<Notification, 'id' | 'timestamp'>): void {
  if (addNotificationExternal) {
    addNotificationExternal(notification);
  }
}

export function NotificationContainer() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotificationInternal = useCallback((notification: Omit<Notification, 'id' | 'timestamp'>) => {
    const id = `notification-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: new Date(),
    };
    setNotifications(prev => [...prev, newNotification]);

    // Auto-dismiss if configured
    if (notification.autoDismiss !== false) {
      const dismissTime = notification.dismissAfter ?? 10000; // Default 10 seconds
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, dismissTime);
    }
  }, []);

  // Register global add function
  useEffect(() => {
    addNotificationExternal = addNotificationInternal;
    return () => {
      addNotificationExternal = null;
    };
  }, [addNotificationInternal]);

  // Listen for budget exceeded events
  useEffect(() => {
    console.log('[NotificationContainer] Setting up budget.exceeded event listener');
    const cleanup = eventBus.on('budget.exceeded', (event: EngineEvent) => {
      console.log('[NotificationContainer] Received budget.exceeded event:', event);
      const dollarExceeded = event.data.dollarExceeded as boolean;
      const tokenExceeded = event.data.tokenExceeded as boolean;
      const dollarsSpent = event.data.dollarsSpent as number;
      const tokensUsed = event.data.tokensUsed as number;
      const maxDollars = event.data.maxDollars as number;
      const maxTokens = event.data.maxTokens as number;

      let message = 'Board execution stopped.\n';
      if (dollarExceeded) {
        message += `Dollar limit: $${dollarsSpent.toFixed(4)} / $${maxDollars.toFixed(2)}\n`;
      }
      if (tokenExceeded) {
        message += `Token limit: ${tokensUsed.toLocaleString()} / ${maxTokens.toLocaleString()}`;
      }

      console.log('[NotificationContainer] Adding budget exceeded notification');
      addNotificationInternal({
        type: 'warning',
        title: 'Budget Exceeded',
        message: message.trim(),
        autoDismiss: true,
        dismissAfter: 15000, // Auto-dismiss after 15 seconds
      });
    });

    return cleanup;
  }, [addNotificationInternal]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  if (notifications.length === 0) return null;

  const getTypeStyles = (type: Notification['type']) => {
    // Use higher opacity (80%) for better visibility with slight transparency
    switch (type) {
      case 'warning':
        return 'bg-amber-900/80 border-accent-warning text-accent-warning';
      case 'error':
        return 'bg-red-900/80 border-accent-danger text-accent-danger';
      case 'success':
        return 'bg-green-900/80 border-accent-success text-accent-success';
      case 'info':
      default:
        return 'bg-blue-900/80 border-accent-info text-accent-info';
    }
  };

  return (
    <div className="fixed left-4 top-16 z-40 flex flex-col gap-2 w-80 min-w-[320px]">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`rounded-lg border p-4 shadow-lg backdrop-blur-md ${getTypeStyles(notification.type)}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <h4 className="font-semibold text-sm">{notification.title}</h4>
              <p className="text-xs mt-1 opacity-90 whitespace-pre-line">{notification.message}</p>
            </div>
            <button
              onClick={() => dismissNotification(notification.id)}
              className="opacity-70 hover:opacity-100 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

