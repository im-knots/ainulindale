/**
 * HexDetailBar Component
 * Bottom bar showing entity details, logs, and chat for the selected hex
 *
 * Features:
 * - Multiple tabs based on entity type (agent vs tool)
 * - Event bus integration for real-time log updates
 * - Per-entity log storage that persists across selection changes
 * - Resizable height with drag handle
 * - Collapsible state
 *
 * Agent tabs: Thoughts, Identity, World, Logs, Metrics
 * Shell tool tabs: Terminal
 * Tasklist tool tabs: Tasks
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelectedEntity, useSelectedHexKey, useEntities, useHexes, useCurrentBoard, useBoards } from '../../store/hooks';
import { useStore } from '../../store';
import { useEventBusAll } from '../../hooks/useEventBus';
import { EngineEvent } from '../../engine/types';
import { Entity, AgentEntity, ToolEntity } from '../../store/types';
import { getAgentTools } from '../../engine/tools/agent-tools';
import { buildSystemPrompt } from '../../engine/prompts';
import { eventBus } from '../../engine/event-bus';
import { LLMMessage, LLMAssistantMessage, LLMToolMessage } from '../../llm/types';
import { pluginRegistry } from '../../engine/tools/plugin-registry';

// Tab types
type TabType = 'thoughts' | 'identity' | 'world' | 'logs' | 'metrics' | 'output' | 'tasks';

// Log entry structure
interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

// Shell output entry
interface ShellOutputEntry {
  content: string;
  timestamp: Date;
  isCommand?: boolean;
}

// User message sent via chat
interface ChatUserMessage {
  content: string;
  timestamp: Date;
}

// World context snapshot
interface WorldContextSnapshot {
  timestamp: Date;
  iteration: number;
  model: string;
  provider: string;
  systemPrompt: string;
  messages: LLMMessage[];
  toolNames: string[];
}

// Task claim info
interface TaskClaimInfo {
  agentEntityId: string;
  agentName: string;
  claimedAt: Date;
}

// Per-entity logs storage
interface EntityLogs {
  logs: LogEntry[];
  thoughts: string[];
  responses: string[];
  shellOutput: ShellOutputEntry[];
  userMessages: ChatUserMessage[];
  showThoughts: boolean;
  worldSnapshots: WorldContextSnapshot[];
}

// Global storage for entity logs (persists across renders)
const entityLogsMap = new Map<string, EntityLogs>();
// Global storage for task claim status: Map<tasklistEntityId, Map<taskTitle, TaskClaimInfo>>
const taskClaimStatus = new Map<string, Map<string, TaskClaimInfo>>();

function getEntityLogs(entityId: string): EntityLogs {
  if (!entityLogsMap.has(entityId)) {
    entityLogsMap.set(entityId, {
      logs: [],
      thoughts: [],
      responses: [],
      shellOutput: [],
      userMessages: [],
      showThoughts: false,
      worldSnapshots: [],
    });
  }
  return entityLogsMap.get(entityId)!;
}

function clearAllLogs(): void {
  entityLogsMap.clear();
  taskClaimStatus.clear();
}

const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;

export function HexDetailBar() {
  const selectedHexKey = useSelectedHexKey();
  const selectedEntity = useSelectedEntity();
  const entities = useEntities();
  const updateEntity = useStore((s) => s.updateEntity);

  const [activeTab, setActiveTab] = useState<TabType>('thoughts');
  const [isExpanded, setIsExpanded] = useState(true);
  const [contentHeight, setContentHeight] = useState(() => {
    const saved = localStorage.getItem('hex-detail-bar-height');
    if (saved) {
      const height = parseInt(saved, 10);
      if (!isNaN(height) && height >= MIN_HEIGHT && height <= MAX_HEIGHT) {
        return height;
      }
    }
    return DEFAULT_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [updateCounter, setUpdateCounter] = useState(0);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  // Force re-render when logs change
  const forceUpdate = useCallback(() => {
    setUpdateCounter((c) => c + 1);
  }, []);

  // Handle events from the engine
  useEventBusAll(
    useCallback(
      (event: EngineEvent) => {
        const entityId = event.hexId;
        if (!entityId) return;

        // Check entity exists
        if (!entities.has(entityId)) return;

        const entityLogs = getEntityLogs(entityId);
        const timestamp = event.timestamp;

        switch (event.type) {
          case 'board.started':
            clearAllLogs();
            forceUpdate();
            break;

          case 'hex.status':
            entityLogs.logs.push({
              timestamp,
              level: 'info',
              message: `Status changed to: ${event.data?.status || 'unknown'}`,
            });
            break;

          case 'hex.progress':
            if (event.data?.thought) {
              entityLogs.thoughts.push(String(event.data.thought));
            }
            entityLogs.logs.push({
              timestamp,
              level: 'info',
              message: `Progress: iteration ${event.data?.iteration || '?'}`,
            });
            break;

          case 'work.received':
            entityLogs.logs.push({
              timestamp,
              level: 'info',
              message: `Received work item: ${event.data?.workItemId || 'unknown'}`,
            });
            break;

          case 'work.completed':
            entityLogs.logs.push({
              timestamp,
              level: 'info',
              message: `Completed work item`,
            });
            break;

          case 'llm.request':
            if (event.data?.fullMessages && event.data?.fullSystemPrompt) {
              entityLogs.worldSnapshots.push({
                timestamp,
                iteration: entityLogs.worldSnapshots.length + 1,
                model: String(event.data.model || ''),
                provider: String(event.data.provider || ''),
                systemPrompt: String(event.data.fullSystemPrompt || ''),
                messages: event.data.fullMessages as LLMMessage[],
                toolNames: (event.data.toolNames as string[]) || [],
              });
            }
            entityLogs.logs.push({
              timestamp,
              level: 'debug',
              message: `[REQUEST] ${event.data?.provider}/${event.data?.model} (${event.data?.toolCount || 0} tools)`,
            });
            break;

          case 'llm.response':
            if (event.data?.error) {
              entityLogs.logs.push({
                timestamp,
                level: 'error',
                message: `[ERROR] ${event.data.error}`,
              });
            } else {
              const usage = event.data?.usage as { totalTokens?: number } | undefined;
              const content = String(event.data?.content || '');

              entityLogs.logs.push({
                timestamp,
                level: 'info',
                message: `[RESPONSE] (${event.data?.finishReason || 'unknown'}) | tokens: ${usage?.totalTokens || '?'}`,
              });

              if (content) {
                entityLogs.responses.push(content);
              }
            }
            break;

          case 'error':
            entityLogs.logs.push({
              timestamp,
              level: 'error',
              message: String(event.data?.message || 'Unknown error'),
            });
            break;

          case 'shell.command.start':
            entityLogs.shellOutput.push({
              content: `$ ${event.data?.command || 'unknown command'}`,
              timestamp,
              isCommand: true,
            });
            entityLogs.logs.push({
              timestamp,
              level: 'info',
              message: `[SHELL] Executing: ${event.data?.command || 'unknown command'}`,
            });
            break;

          case 'shell.command.output':
            if (event.data?.output) {
              const prefix = event.data?.stream === 'stderr' ? '[stderr] ' : '';
              entityLogs.shellOutput.push({
                content: `${prefix}${event.data.output}`,
                timestamp,
              });
            }
            break;

          case 'shell.command.exit':
            if (event.data?.exitCode !== undefined && event.data.exitCode !== 0) {
              entityLogs.shellOutput.push({
                content: `[exit code: ${event.data.exitCode}]`,
                timestamp,
              });
            }
            break;

          case 'task.claimed': {
            const claimedTaskTitle = event.data.taskTitle as string;
            const claimedByEntityId = event.data.claimedByEntityId as string;
            const claimedByName = event.data.claimedByName as string;
            if (claimedTaskTitle && claimedByEntityId && claimedByName) {
              if (!taskClaimStatus.has(entityId)) {
                taskClaimStatus.set(entityId, new Map());
              }
              taskClaimStatus.get(entityId)!.set(claimedTaskTitle, {
                agentEntityId: claimedByEntityId,
                agentName: claimedByName,
                claimedAt: timestamp,
              });
            }
            entityLogs.logs.push({
              timestamp,
              level: 'info',
              message: `[TASK] "${claimedTaskTitle}" claimed by ${claimedByName || 'unknown'}`,
            });
            break;
          }

          case 'task.completed': {
            const completedTaskTitle = event.data.taskTitle as string;
            if (completedTaskTitle && taskClaimStatus.has(entityId)) {
              taskClaimStatus.get(entityId)!.delete(completedTaskTitle);
            }
            entityLogs.logs.push({
              timestamp,
              level: 'info',
              message: `[TASK] "${completedTaskTitle}" completed`,
            });
            break;
          }

          case 'task.released': {
            const releasedTaskTitle = event.data.taskTitle as string;
            if (releasedTaskTitle && taskClaimStatus.has(entityId)) {
              taskClaimStatus.get(entityId)!.delete(releasedTaskTitle);
            }
            entityLogs.logs.push({
              timestamp,
              level: 'info',
              message: `[TASK] "${releasedTaskTitle}" released`,
            });
            break;
          }
        }

        // Trim logs
        if (entityLogs.logs.length > 100) {
          entityLogs.logs.splice(0, entityLogs.logs.length - 100);
        }
        if (entityLogs.thoughts.length > 50) {
          entityLogs.thoughts.splice(0, entityLogs.thoughts.length - 50);
        }
        if (entityLogs.responses.length > 50) {
          entityLogs.responses.splice(0, entityLogs.responses.length - 50);
        }
        if (entityLogs.shellOutput.length > 200) {
          entityLogs.shellOutput.splice(0, entityLogs.shellOutput.length - 200);
        }

        // Force update if this is for current entity
        if (selectedEntity && entityId === selectedEntity.id) {
          forceUpdate();
        }
      },
      [selectedEntity, entities, forceUpdate]
    )
  );

  // Handle resize
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartY.current - e.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartHeight.current + delta));
      setContentHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem('hex-detail-bar-height', String(contentHeight));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, contentHeight]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = contentHeight;
    setIsResizing(true);
  };

  // Determine which tabs to show
  // Agents only show their 5 core tabs - tool tabs are accessed by selecting the tool hex
  const tabs = useMemo(() => {
    if (!selectedEntity) return [];

    if (selectedEntity.category === 'tool') {
      const toolEntity = selectedEntity as ToolEntity;
      // Query plugin registry for UI config
      const plugin = pluginRegistry.get(toolEntity.toolType);
      if (plugin?.ui?.detailTabs && plugin.ui.detailTabs.length > 0) {
        return plugin.ui.detailTabs.map((tab) => ({
          id: tab.id as TabType,
          label: tab.label,
        }));
      }
      return [];
    }

    // Agent tabs - only core tabs, no tool-specific tabs
    return [
      { id: 'thoughts' as TabType, label: 'Thoughts' },
      { id: 'identity' as TabType, label: 'Identity' },
      { id: 'world' as TabType, label: 'World' },
      { id: 'logs' as TabType, label: 'Logs' },
      { id: 'metrics' as TabType, label: 'Metrics' },
    ];
  }, [selectedEntity]);

  // Set default tab when entity changes (not when activeTab changes)
  useEffect(() => {
    if (!selectedEntity) return;

    if (selectedEntity.category === 'tool') {
      const toolEntity = selectedEntity as ToolEntity;
      // Query plugin registry for UI config
      const plugin = pluginRegistry.get(toolEntity.toolType);
      if (plugin?.ui?.detailTabs && plugin.ui.detailTabs.length > 0) {
        const validTabIds = plugin.ui.detailTabs.map((t) => t.id);
        // Only reset if current tab is not valid for this plugin
        if (!validTabIds.includes(activeTab)) {
          setActiveTab((plugin.ui.defaultTab || plugin.ui.detailTabs[0].id) as TabType);
        }
      }
    } else if (selectedEntity.category === 'agent') {
      // Reset to thoughts if coming from a tool-specific tab (not an agent tab)
      const agentTabs = ['thoughts', 'identity', 'world', 'logs', 'metrics'];
      if (!agentTabs.includes(activeTab)) {
        setActiveTab('thoughts');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntity?.id]);

  // Determine if bar should be shown
  const shouldShow = useMemo(() => {
    if (!selectedHexKey || !selectedEntity) return false;

    if (selectedEntity.category === 'agent') return true;
    if (selectedEntity.category === 'tool') {
      const toolEntity = selectedEntity as ToolEntity;
      // Query plugin registry - show bar if plugin has detail tabs
      const plugin = pluginRegistry.get(toolEntity.toolType);
      return (plugin?.ui?.detailTabs?.length ?? 0) > 0;
    }
    return false;
  }, [selectedHexKey, selectedEntity]);

  // Don't render anything if nothing to show - the canvas takes full space
  if (!shouldShow) {
    return null;
  }

  if (!isExpanded) {
    return (
      <div className="fixed bottom-0 left-0 right-80 h-10 bg-bg-secondary/95 backdrop-blur-sm border-t border-border flex items-center px-4 z-10">
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 text-text-secondary hover:text-text-primary"
          title="Expand panel"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
          <span className="text-sm">Expand</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-80 bg-bg-secondary/95 backdrop-blur-sm border-t border-border flex flex-col z-10"
      style={{ height: contentHeight + 40 }}
    >
      {/* Resize handle */}
      <div
        className="h-1 cursor-ns-resize bg-transparent hover:bg-accent-primary/30 transition-colors"
        onMouseDown={handleResizeStart}
      />

      {/* Header with tabs */}
      <div className="flex items-center h-10 px-4 border-b border-border shrink-0">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeTab === tab.id
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsExpanded(false)}
          className="ml-auto p-1 text-text-muted hover:text-text-secondary"
          title="Collapse"
        >
          <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden" data-update={updateCounter}>
        {activeTab === 'thoughts' && selectedEntity && (
          <ThoughtsTab entityId={selectedEntity.id} />
        )}
        {activeTab === 'identity' && selectedEntity?.category === 'agent' && (
          <IdentityTab entity={selectedEntity as AgentEntity} onUpdate={updateEntity} />
        )}
        {activeTab === 'world' && selectedEntity && <WorldTab entityId={selectedEntity.id} />}
        {activeTab === 'logs' && selectedEntity && <LogsTab entityId={selectedEntity.id} />}
        {activeTab === 'metrics' && selectedEntity && <MetricsTab entity={selectedEntity} />}
        {activeTab === 'output' && selectedEntity && <TerminalTab entityId={selectedEntity.id} />}
        {activeTab === 'tasks' && selectedEntity?.category === 'tool' && (
          <TasksTab entity={selectedEntity as ToolEntity} />
        )}
      </div>
    </div>
  );
}

// ============ Thoughts Tab ============
function ThoughtsTab({ entityId }: { entityId: string }) {
  const [inputValue, setInputValue] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const logs = getEntityLogs(entityId);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [logs.responses.length, logs.userMessages.length, logs.thoughts.length]);

  const handleToggleThoughts = () => {
    logs.showThoughts = !logs.showThoughts;
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    logs.userMessages.push({
      content: inputValue.trim(),
      timestamp: new Date(),
    });

    // Emit user message event
    eventBus.emit({
      type: 'user.message',
      hexId: entityId,
      boardId: '',
      data: { content: inputValue.trim() },
      timestamp: new Date(),
    });

    setInputValue('');
  };

  // Build combined message list
  const messages: Array<{ type: 'user' | 'assistant' | 'thought'; content: string; timestamp: Date }> = [];

  logs.userMessages.forEach((um) => {
    messages.push({ type: 'user', content: um.content, timestamp: um.timestamp });
  });

  logs.responses.forEach((r, i) => {
    const timestamp = new Date(Date.now() - (logs.responses.length - i) * 1000);
    messages.push({ type: 'assistant', content: r, timestamp });
  });

  if (logs.showThoughts) {
    logs.thoughts.forEach((t, i) => {
      const timestamp = new Date(Date.now() - (logs.thoughts.length - i) * 500);
      messages.push({ type: 'thought', content: t, timestamp });
    });
  }

  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return (
    <div className="h-full flex flex-col">
      {/* Header with toggle */}
      <div className="flex items-center justify-end px-4 py-2 border-b border-border">
        <button
          onClick={handleToggleThoughts}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
            logs.showThoughts
              ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30'
              : 'bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/80'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Show Thoughts
        </button>
      </div>

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-text-muted py-8">
            No messages yet. Run the board with an agent.
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`rounded-lg p-3 ${
                msg.type === 'user'
                  ? 'bg-accent-primary/20 ml-8'
                  : msg.type === 'thought'
                    ? 'bg-accent-warning/10 border border-accent-warning/30'
                    : 'bg-bg-tertiary mr-8'
              }`}
            >
              <div className="text-xs text-text-muted mb-1">
                {msg.type === 'user' ? 'You' : msg.type === 'thought' ? 'Thought' : 'Agent'}
              </div>
              <div className="text-sm text-text-primary whitespace-pre-wrap">{msg.content}</div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 p-4 border-t border-border">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Send a message to guide the agent..."
          className="flex-1 bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
        />
        <button
          onClick={handleSendMessage}
          className="px-4 py-2 bg-accent-primary text-white text-sm rounded-md hover:bg-accent-primary/80 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ============ Identity Tab ============
function IdentityTab({
  entity,
  onUpdate,
}: {
  entity: AgentEntity;
  onUpdate: (id: string, updates: Partial<Entity>) => void;
}) {
  // Use individual hooks instead of object selector to avoid infinite re-renders
  const hexes = useHexes();
  const entities = useEntities();
  const currentBoard = useCurrentBoard();
  const boards = useBoards();

  const [customInstructions, setCustomInstructions] = useState(entity.systemPrompt || '');

  // Build the full system prompt
  const renderedPrompt = useMemo(() => {
    const appState = {
      hexes: hexes,
      entities: entities,
      selectedHex: null,
      selectedBoard: currentBoard?.id || null,
      boards: boards,
      previewRange: null,
      resources: { dollars: 0, tokens: 0 },
      editorState: { isOpen: false, content: '', entityId: null },
    } as any;

    const { tools, detailedToolInfo } = getAgentTools(entity.id, appState);
    return buildSystemPrompt({
      agentEntity: entity as any,
      availableTools: tools,
      state: appState,
      detailedToolInfo,
    });
  }, [entity, hexes, entities, currentBoard, boards]);

  const handleSave = () => {
    onUpdate(entity.id, { systemPrompt: customInstructions } as Partial<AgentEntity>);
  };

  const handleClear = () => {
    setCustomInstructions('');
    onUpdate(entity.id, { systemPrompt: '' } as Partial<AgentEntity>);
  };

  return (
    <div className="h-full flex gap-4 p-4 overflow-hidden">
      {/* Left: Generated prompt */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-text-primary">Generated System Prompt</span>
          <span className="text-xs text-text-muted">{renderedPrompt.length} chars</span>
        </div>
        <div className="flex-1 bg-bg-tertiary rounded-lg p-3 overflow-auto">
          <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono">
            {renderedPrompt}
          </pre>
        </div>
      </div>

      {/* Right: Custom instructions */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-text-primary">Append Custom Instructions</span>
          {customInstructions.trim() && (
            <span className="text-xs bg-accent-success/20 text-accent-success px-2 py-0.5 rounded">
              Active
            </span>
          )}
        </div>
        <p className="text-xs text-text-muted mb-2">
          These instructions are <strong>appended</strong> to the end of the generated system prompt.
        </p>
        <textarea
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="Add additional instructions..."
          className="flex-1 bg-bg-tertiary border border-border rounded-lg p-3 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-primary"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-accent-primary text-white text-sm rounded-md hover:bg-accent-primary/80"
          >
            Save
          </button>
          {customInstructions.trim() && (
            <button
              onClick={handleClear}
              className="px-3 py-1.5 bg-bg-tertiary text-text-secondary text-sm rounded-md hover:bg-bg-tertiary/80"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ World Tab ============
function WorldTab({ entityId }: { entityId: string }) {
  const logs = getEntityLogs(entityId);
  const snapshots = logs.worldSnapshots;

  if (snapshots.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-text-muted">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="opacity-30 mb-4"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <p className="text-sm">No context snapshots yet</p>
        <span className="text-xs">Context will appear here as the agent processes work</span>
      </div>
    );
  }

  const currentSnapshot = snapshots[snapshots.length - 1];
  const nonSystemMessages = currentSnapshot.messages.filter((m) => m.role !== 'system');

  // Separate action log from context
  let actionLogContent: string | null = null;
  const contextMessages: LLMMessage[] = [];

  for (const msg of nonSystemMessages) {
    const content = msg.content || '';
    if (msg.role === 'user' && content.startsWith('## Previous Work Summary')) {
      actionLogContent = content;
    } else {
      contextMessages.push(msg);
    }
  }

  return (
    <div className="h-full flex gap-4 p-4 overflow-hidden">
      {/* Left: Context */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-text-primary">Current Context</span>
          <span className="text-xs text-text-muted">
            Iteration {currentSnapshot.iteration} - {currentSnapshot.model}
          </span>
        </div>
        <div className="flex-1 bg-bg-tertiary rounded-lg p-3 overflow-auto space-y-3">
          {contextMessages.map((msg, i) => (
            <div
              key={i}
              className={`rounded p-2 ${
                msg.role === 'assistant'
                  ? 'bg-accent-primary/10'
                  : msg.role === 'tool'
                    ? 'bg-accent-info/10'
                    : 'bg-bg-secondary'
              }`}
            >
              <div className="text-xs text-text-muted mb-1">
                {msg.role === 'assistant'
                  ? 'Thought'
                  : msg.role === 'tool'
                    ? `Observation (${(msg as LLMToolMessage).toolName})`
                    : 'Context'}
              </div>
              <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono">
                {msg.content}
              </pre>
              {msg.role === 'assistant' && (msg as LLMAssistantMessage).toolCalls && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs text-text-muted">Tool Calls:</div>
                  {(msg as LLMAssistantMessage).toolCalls!.map((tc, j) => (
                    <div key={j} className="bg-bg-tertiary rounded p-2">
                      <span className="text-xs text-accent-primary font-medium">{tc.toolName}</span>
                      <pre className="text-xs text-text-muted mt-1">
                        {JSON.stringify(tc.args, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Action log */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-text-primary">Action Log</span>
        </div>
        <div className="flex-1 bg-bg-tertiary rounded-lg p-3 overflow-auto">
          {actionLogContent ? (
            <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono">
              {actionLogContent}
            </pre>
          ) : (
            <div className="text-center text-text-muted py-4 text-sm">
              No previous work summary yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Logs Tab ============
function LogsTab({ entityId }: { entityId: string }) {
  const logs = getEntityLogs(entityId);
  const logEntries = logs.logs;

  if (logEntries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No logs yet. Activity will appear here.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-1">
      {logEntries
        .slice(-50)
        .reverse()
        .map((log, i) => (
          <div key={i} className="flex gap-2 text-xs font-mono">
            <span className="text-text-muted shrink-0">
              {log.timestamp.toLocaleTimeString()}
            </span>
            <span
              className={`shrink-0 w-12 ${
                log.level === 'error'
                  ? 'text-accent-danger'
                  : log.level === 'warn'
                    ? 'text-accent-warning'
                    : log.level === 'debug'
                      ? 'text-text-muted'
                      : 'text-text-secondary'
              }`}
            >
              {log.level.toUpperCase()}
            </span>
            <span className="text-text-primary break-all">{log.message}</span>
          </div>
        ))}
    </div>
  );
}

// ============ Metrics Tab ============
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function MetricsTab({ entity }: { entity: Entity }) {
  const isAgent = entity.category === 'agent';

  return (
    <div className="h-full overflow-auto p-4 space-y-2">
      <div className="flex justify-between py-2 border-b border-border">
        <span className="text-sm text-text-muted">Status</span>
        <span className="text-sm text-text-primary">{entity.status}</span>
      </div>
      <div className="flex justify-between py-2 border-b border-border">
        <span className="text-sm text-text-muted">Category</span>
        <span className="text-sm text-text-primary">{entity.category}</span>
      </div>

      {/* Agent-specific metrics: LLM calls and tokens */}
      {isAgent && (
        <>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-sm text-text-muted">LLM Calls</span>
            <span className="text-sm text-text-primary font-medium">
              {entity.metrics?.llmCallCount || 0}
            </span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-sm text-text-muted">Run Tokens</span>
            <span className="text-sm text-accent-info font-medium">
              {formatTokens(entity.metrics?.runTokens || 0)}
            </span>
          </div>
        </>
      )}

      {/* General metrics for all entities */}
      {entity.metrics && (
        <>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-sm text-text-muted">Throughput</span>
            <span className="text-sm text-text-primary">
              {entity.metrics.throughput?.toFixed(2) || '0'} items/min
            </span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-sm text-text-muted">Latency</span>
            <span className="text-sm text-text-primary">
              {entity.metrics.latencyMs?.toFixed(0) || '0'} ms
            </span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-sm text-text-muted">Queue Depth</span>
            <span className="text-sm text-text-primary">{entity.metrics.queueDepth || 0}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ============ Terminal Tab ============
function TerminalTab({ entityId }: { entityId: string }) {
  const [inputValue, setInputValue] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const logs = getEntityLogs(entityId);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [logs.shellOutput.length]);

  const formatTimestamp = (date: Date) => {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  };

  return (
    <div className="h-full flex flex-col bg-black/50">
      <div ref={outputRef} className="flex-1 overflow-auto p-4 font-mono text-xs">
        {logs.shellOutput.length === 0 ? (
          <div className="text-green-500/50">
            Terminal ready. Commands executed by agents will appear here.
          </div>
        ) : (
          logs.shellOutput.map((entry, i) => (
            <div key={i} className="whitespace-pre-wrap">
              <span className="text-text-muted">[{formatTimestamp(entry.timestamp)}]</span>{' '}
              <span className={entry.isCommand ? 'text-green-400' : 'text-text-primary'}>
                {entry.content}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 p-2 border-t border-border">
        <span className="text-green-400 font-mono">$</span>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter command..."
          className="flex-1 bg-transparent border-none text-sm text-text-primary font-mono focus:outline-none"
        />
      </div>
    </div>
  );
}

// ============ Tasks Tab ============
function TasksTab({ entity }: { entity: ToolEntity }) {
  const [inputValue, setInputValue] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const updateEntity = useStore((s) => s.updateEntity);

  const tasks: Array<{ title: string; description?: string; completed: boolean }> =
    ((entity.config?.tasks as Array<{ title: string; description?: string; completed: boolean }>) || []);

  const pendingCount = tasks.filter((t) => !t.completed).length;
  const completedCount = tasks.filter((t) => t.completed).length;
  const claimStatusMap = taskClaimStatus.get(entity.id);
  const processingCount = claimStatusMap?.size || 0;

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingIndex]);

  const handleAddTask = () => {
    if (!inputValue.trim()) return;

    const newTasks = [...tasks, { title: inputValue.trim(), completed: false }];
    updateEntity(entity.id, { config: { ...entity.config, tasks: newTasks } });
    setInputValue('');
  };

  const handleToggleTask = (index: number) => {
    const newTasks = [...tasks];
    newTasks[index] = { ...newTasks[index], completed: !newTasks[index].completed };
    updateEntity(entity.id, { config: { ...entity.config, tasks: newTasks } });
  };

  const handleDeleteTask = (index: number) => {
    const newTasks = tasks.filter((_, i) => i !== index);
    updateEntity(entity.id, { config: { ...entity.config, tasks: newTasks } });
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditValue(tasks[index].title);
  };

  const handleSaveEdit = () => {
    if (editingIndex === null) return;

    if (editValue.trim()) {
      const newTasks = [...tasks];
      newTasks[editingIndex] = { ...newTasks[editingIndex], title: editValue.trim() };
      updateEntity(entity.id, { config: { ...entity.config, tasks: newTasks } });
    }
    setEditingIndex(null);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditValue('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border">
        <span className="text-sm text-text-muted">
          <span className="text-accent-warning">{pendingCount}</span> pending
        </span>
        {processingCount > 0 && (
          <span className="text-sm text-text-muted">
            <span className="text-accent-info">{processingCount}</span> processing
          </span>
        )}
        <span className="text-sm text-text-muted">
          <span className="text-accent-success">{completedCount}</span> done
        </span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-auto p-4 space-y-2">
        {tasks.length === 0 ? (
          <div className="text-center text-text-muted py-8">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              className="mx-auto opacity-30 mb-4"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <p className="text-sm">Queue is empty</p>
            <span className="text-xs">Add tasks below to get started</span>
          </div>
        ) : (
          tasks.map((task, i) => {
            const claimInfo = claimStatusMap?.get(task.title);
            const isProcessing = !!claimInfo;

            return (
              <div
                key={i}
                className={`flex items-center gap-3 p-3 rounded-lg ${
                  task.completed
                    ? 'bg-accent-success/10'
                    : isProcessing
                      ? 'bg-accent-info/10 border border-accent-info/30'
                      : 'bg-bg-tertiary'
                }`}
              >
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => handleToggleTask(i)}
                  className="rounded"
                />
                <div className="flex-1 min-w-0">
                  {editingIndex === i ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      onBlur={handleSaveEdit}
                      className="w-full bg-bg-primary border border-accent-primary rounded px-2 py-1 text-sm text-text-primary focus:outline-none"
                    />
                  ) : (
                    <span
                      onClick={() => !isProcessing && !task.completed && handleStartEdit(i)}
                      className={`text-sm cursor-pointer ${
                        task.completed
                          ? 'line-through text-text-muted cursor-default'
                          : isProcessing
                            ? 'text-text-primary cursor-default'
                            : 'text-text-primary hover:text-accent-primary'
                      }`}
                      title={task.completed || isProcessing ? undefined : 'Click to edit'}
                    >
                      {task.title}
                    </span>
                  )}
                  {task.description && editingIndex !== i && (
                    <p className="text-xs text-text-muted mt-0.5">
                      {typeof task.description === 'string' ? task.description : JSON.stringify(task.description)}
                    </p>
                  )}
                </div>
                {isProcessing && (
                  <span className="flex items-center gap-1 text-xs text-accent-info">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="animate-spin"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    {claimInfo.agentName}
                  </span>
                )}
                <button
                  onClick={() => handleDeleteTask(i)}
                  className="p-1 text-text-muted hover:text-accent-danger"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Add task input */}
      <div className="flex gap-2 p-4 border-t border-border">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
          placeholder="Add a new task..."
          className="flex-1 bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
        />
        <button
          onClick={handleAddTask}
          className="px-4 py-2 bg-accent-primary text-white text-sm rounded-md hover:bg-accent-primary/80 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default HexDetailBar;

