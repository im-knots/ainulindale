/**
 * ResourceBar Component
 * Displays budget/spend for dollars and tokens, work stats, and swarm controls
 *
 * Layout:
 * LEFT: Resource section (Cost, Tokens)
 * MIDDLE: Work section (Active Agents, Pending, In Progress, Done, Tasks/hr)
 * RIGHT: Swarm controls (Status indicator, Start/Stop button, Settings button)
 */

import { useState, useEffect, useRef } from 'react';
import { useSwarmStatus, useCurrentBoard } from '../../store/hooks';
import { useWorkStatsFromEvents } from '../../hooks/useWorkStatsFromEvents';
import { startBoardExecution, stopBoardExecution } from '../../engine/board-execution';
import { useStore } from '../../store';
import * as tauriDb from '../../services/tauriDatabase';
import { eventBus } from '../../engine/event-bus';

interface ResourceBarProps {
  onSettingsClick: () => void;
}

export function ResourceBar({ onSettingsClick }: ResourceBarProps) {
  // Live work stats from EventBus (source of truth for real-time metrics)
  const workStats = useWorkStatsFromEvents();
  // Persistent state from Zustand (backed by SQLite)
  const swarmStatus = useSwarmStatus();
  const currentBoard = useCurrentBoard();
  const updateResources = useStore((state) => state.updateResources);

  const [isLoading, setIsLoading] = useState(false);

  // Budget popdown state
  const [isBudgetPopdownOpen, setIsBudgetPopdownOpen] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const popdownRef = useRef<HTMLDivElement>(null);
  const resourceSectionRef = useRef<HTMLDivElement>(null);

  // Load budget when popdown opens
  useEffect(() => {
    if (isBudgetPopdownOpen && currentBoard) {
      setTokenBudget(currentBoard.max_tokens.toString());
      setBudgetError(null);
    }
  }, [isBudgetPopdownOpen, currentBoard]);

  // Close popdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popdownRef.current && !popdownRef.current.contains(event.target as Node) &&
          resourceSectionRef.current && !resourceSectionRef.current.contains(event.target as Node)) {
        setIsBudgetPopdownOpen(false);
      }
    };

    if (isBudgetPopdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isBudgetPopdownOpen]);

  const formatTokens = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toString();
  };

  /**
   * Parse human-readable number strings like "1k", "2.5M", "100" into numbers.
   * Supports: k/K (thousands), m/M (millions), b/B (billions), t/T (trillions)
   */
  const parseHumanNumber = (input: string): number | null => {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === '' || trimmed === '0') return 0;

    // Match number with optional suffix: "25", "1.5k", "2.5m", etc.
    const match = trimmed.match(/^([0-9]*\.?[0-9]+)\s*([kmbt]?)$/);
    if (!match) return null;

    const num = parseFloat(match[1]);
    if (isNaN(num)) return null;

    const suffix = match[2];
    const multipliers: Record<string, number> = {
      '': 1,
      'k': 1_000,
      'm': 1_000_000,
      'b': 1_000_000_000,
      't': 1_000_000_000_000,
    };

    return num * (multipliers[suffix] ?? 1);
  };

  const handleSaveBudget = async () => {
    if (!currentBoard) return;

    const tokenValue = parseHumanNumber(tokenBudget);

    // Validation
    if (tokenValue === null || tokenValue < 0) {
      setBudgetError('Invalid token budget. Use numbers like 1000, 100k, 1m');
      return;
    }

    setIsSaving(true);
    setBudgetError(null);

    try {
      // Keep dollar budget at 0 (unlimited) - we only track tokens in UI
      const dollarValue = 0;

      // Update board in database
      await tauriDb.updateBoard(currentBoard.id, {
        maxDollars: dollarValue,
        maxTokens: tokenValue,
      });

      // Update store resources using unified naming
      updateResources({
        dollars: {
          max: dollarValue,
          total: currentBoard.total_dollars,
          projected: 0,
          rate: 0,
        },
        tokens: {
          max: tokenValue,
          total: currentBoard.total_tokens,
          projected: 0,
          rate: 0,
        },
      });

      // Reload boards to sync state
      const boards = await tauriDb.listBoards();
      useStore.getState().setBoards(boards);
      const updatedBoard = boards.find(b => b.id === currentBoard.id);
      if (updatedBoard) {
        useStore.getState().setCurrentBoard(updatedBoard);
      }

      // Emit event so running BudgetTracker updates its limits immediately
      eventBus.emit({
        type: 'budget.limits.updated',
        hexId: '',
        boardId: currentBoard.id,
        data: {
          maxDollars: dollarValue,
          maxTokens: tokenValue,
        },
        timestamp: new Date(),
      });

      setIsBudgetPopdownOpen(false);
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : 'Failed to save budget');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleExecution = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      if (swarmStatus === 'running') {
        await stopBoardExecution();
      } else {
        await startBoardExecution();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (swarmStatus) {
      case 'running': return 'bg-accent-success';
      case 'paused': return 'bg-accent-warning';
      case 'stopped': return 'bg-text-muted';
      default: return 'bg-text-muted';
    }
  };

  const isRunning = swarmStatus === 'running';
  const canStart = currentBoard !== null && !isLoading;

  // Calculate budget progress percentages using persistent totals
  const tokenBudgetLimit = currentBoard?.max_tokens || 0;
  const totalTokensUsed = currentBoard?.total_tokens || 0;
  const tokenProgress = tokenBudgetLimit > 0 ? Math.min((totalTokensUsed / tokenBudgetLimit) * 100, 100) : 0;

  return (
    <>
      <div className="flex items-center gap-6">
        {/* LEFT: Resource Section - Tokens (computed from all entities) */}
        <div className="relative flex items-center gap-4" ref={resourceSectionRef}>
          {/* Token Budget - Shows lifetime total from database */}
          <button
            onClick={() => setIsBudgetPopdownOpen(!isBudgetPopdownOpen)}
            className="flex flex-col min-w-[100px] hover:bg-bg-tertiary/50 px-2 py-1 rounded transition-colors cursor-pointer"
            title="Lifetime tokens for this board - click to configure budget"
          >
            <span className="text-xs text-text-muted uppercase tracking-wide">Total Tokens</span>
            <span className="text-lg font-medium text-text-primary">{formatTokens(totalTokensUsed)}</span>
            <div className="w-full h-1 bg-bg-tertiary rounded-full mt-1 mb-1 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  tokenBudgetLimit === 0
                    ? 'bg-text-muted/30'
                    : tokenProgress >= 100
                      ? 'bg-accent-danger'
                      : tokenProgress >= 80
                        ? 'bg-accent-warning'
                        : 'bg-accent-info'
                }`}
                style={{ width: tokenBudgetLimit === 0 ? '100%' : `${tokenProgress}%` }}
              />
            </div>
          </button>

          {/* Budget Popdown Menu */}
          {isBudgetPopdownOpen && (
            <div
              ref={popdownRef}
              className="absolute top-full left-0 mt-2 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl z-50"
            >
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-medium text-text-primary">Board Budget</h3>
                <p className="text-xs text-text-muted mt-1">Lifetime limits for this board (0 = unlimited)</p>
              </div>

              <div className="px-4 py-3 space-y-3">
                {budgetError && (
                  <div className="px-3 py-2 bg-accent-danger/20 border border-accent-danger/50 rounded text-accent-danger text-xs">
                    {budgetError}
                  </div>
                )}

                {/* Token Budget Input */}
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Token Limit
                  </label>
                  <input
                    type="text"
                    value={tokenBudget}
                    onChange={(e) => setTokenBudget(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveBudget()}
                    className="w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent-info"
                    placeholder="0, 100k, 1m"
                  />
                </div>

                <p className="text-xs text-text-muted">
                  Use k, m, b for thousands, millions, billions (e.g., 100k, 1.5m)
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
                <button
                  onClick={() => setIsBudgetPopdownOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBudget}
                  disabled={isSaving}
                  className="px-3 py-1.5 text-xs font-medium bg-accent-info text-white rounded hover:bg-accent-info/80 transition-colors disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>

      {/* MIDDLE: Work Section */}
      <div className="flex items-center px-4 border-l border-border">
        <div className="flex flex-col items-center w-16">
          <span className="text-lg font-medium text-accent-info">{workStats.activeAgents}</span>
          <span className="text-xs text-text-muted">Active</span>
        </div>
        <div className="flex flex-col items-center w-16">
          <span className="text-lg font-medium text-text-primary">{workStats.pendingTasks}</span>
          <span className="text-xs text-text-muted">Pending</span>
        </div>
        <div className="flex flex-col items-center w-16">
          <span className="text-lg font-medium text-accent-warning">{workStats.inProgressTasks}</span>
          <span className="text-xs text-text-muted">Progress</span>
        </div>
        <div className="flex flex-col items-center w-16">
          <span className="text-lg font-medium text-accent-success">{workStats.completedTasks}</span>
          <span className="text-xs text-text-muted">Done</span>
        </div>
        <div className="flex flex-col items-center w-16">
          <span className="text-lg font-medium text-text-secondary">{workStats.tasksPerHour.toFixed(1)}</span>
          <span className="text-xs text-text-muted">Tasks/hr</span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* RIGHT: Swarm Controls */}
      <div className="flex items-center gap-3 pl-4 border-l border-border">
        {/* Status Indicator */}
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor()} ${isRunning ? 'animate-pulse' : ''}`} />
          <span className="text-sm font-medium text-text-secondary uppercase tracking-wide">
            {isLoading ? (isRunning ? 'Stopping...' : 'Starting...') : swarmStatus}
          </span>
        </div>

        {/* Start/Stop Toggle Button */}
        <button
          onClick={handleToggleExecution}
          disabled={!canStart && !isRunning}
          className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            isRunning
              ? 'bg-accent-danger/20 text-accent-danger hover:bg-accent-danger/30'
              : canStart
                ? 'bg-accent-success/20 text-accent-success hover:bg-accent-success/30'
                : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
          }`}
          title={isRunning ? 'Stop board execution' : 'Start board execution'}
        >
          {isRunning ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
              <span>Stop</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Start</span>
            </>
          )}
        </button>

        {/* Settings Button */}
        <button
          onClick={onSettingsClick}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-md hover:bg-bg-tertiary"
          title="Settings"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    </div>
  </>
  );
}

export default ResourceBar;

