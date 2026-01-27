/**
 * AgentActor - Processes work items using LLM reasoning
 *
 * Uses tools from adjacent tool hexes via RBAC-aware discovery.
 * Tool calls are handled natively by the Vercel AI SDK.
 *
 * Pull-based task queue model:
 * - Agents with READ permission to a tasklist can claim tasks
 * - Agents with WRITE permission to a tasklist can add tasks
 */

import { AgentEntity, ToolEntity } from '../../state/store';
import { WorkItem, AgentState, Thought, Observation, Action, ThoughtToolCall, UserMessage, EngineEvent } from '../types';
import { BaseActor, ActorConfig } from './base-actor';
import { llmClient } from '../../llm/client';
import { LLMProviderType, LLMMessage } from '../../llm/types';
import { getAgentTools, AgentToolDefinition } from '../tools/agent-tools';
import { buildSystemPrompt } from '../prompts';
import { checkPermission } from '../../rbac/permissions';
import { getResourcesInRange } from '../../hex/adjacency';
import { ToolActor, QueueTask } from './tool-actor';
import { fileReservationManager, changeTracker, filesystemContextManager } from '../context';

export class AgentActor extends BaseActor {
  private unsubscribeTasksAvailable?: () => void;
  private unsubscribeUserMessage?: () => void;
  private unsubscribeEntityUpdated?: () => void;
  private unsubscribeFilesystemChanged?: () => void;
  // Current work item being processed (for injecting user messages)
  private currentWorkItem: WorkItem | null = null;
  // Abort controller for graceful stop
  private abortController: AbortController | null = null;
  // Flag to track if agent has been stopped (persists even after cleanup)
  private stopped: boolean = false;

  constructor(config: ActorConfig) {
    super(config);
  }

  private get agentEntity(): AgentEntity {
    return this.config.entity as AgentEntity;
  }

  /**
   * Override start to subscribe to task availability events and check for initial work
   */
  async start(): Promise<void> {
    // Reset stopped flag when starting
    this.stopped = false;

    await super.start();

    // Subscribe to tasks.available events from adjacent tasklists
    this.unsubscribeTasksAvailable = this.config.eventBus.on('tasks.available', (event) => {
      // Check if this event is from an adjacent tasklist we can read from
      const toolHexKey = event.data.toolHexKey as string;
      if (toolHexKey && this.canReadFromTasklist(toolHexKey)) {
        // Try to claim a task if we're idle
        this.tryClaimTask();
      }
    });

    // Subscribe to user.message events for this agent
    this.unsubscribeUserMessage = this.config.eventBus.on('user.message', (event) => {
      if (event.hexId === this.config.entity.id) {
        const message = event.data.content as string;
        if (!message) return;

        if (this.currentWorkItem && this.currentWorkItem.agentState) {
          // Agent is busy - inject message as guidance for the active task
          const userMessage: UserMessage = {
            content: message,
            timestamp: new Date(),
            afterThoughtIndex: this.currentWorkItem.agentState.thoughts.length - 1,
          };
          if (!this.currentWorkItem.agentState.userMessages) {
            this.currentWorkItem.agentState.userMessages = [];
          }
          this.currentWorkItem.agentState.userMessages.push(userMessage);
          console.log(`[Agent ${this.agentEntity.name}] Injecting user guidance: ${message.substring(0, 50)}...`);
          // Update work item in queue
          this.config.workQueue.update(this.currentWorkItem.id, this.currentWorkItem);
        } else if (!this.isBusy()) {
          // Agent is idle - treat user message as a new task
          console.log(`[Agent ${this.agentEntity.name}] Received new task from user: ${message.substring(0, 50)}...`);
          const workItem = this.createWorkItemFromUserPrompt(message);
          this.receiveWork(workItem);
        }
      }
    });

    // Subscribe to entity.updated events to invalidate tool cache when adjacent tools change
    this.unsubscribeEntityUpdated = this.config.eventBus.on('entity.updated', (event) => {
      // Only care about tool entity updates
      if (event.data.category !== 'tool') return;

      // Check if this tool is adjacent to us (could affect our available tools)
      const toolHexKey = event.data.hexKey as string;
      if (toolHexKey && this.isToolInRange(toolHexKey)) {
        console.log(`[Agent ${this.agentEntity.name}] Adjacent tool entity updated, invalidating tool cache`);
        this.invalidateToolCache();
      }
    });

    // Subscribe to filesystem.changed events from adjacent filesystem tools
    this.unsubscribeFilesystemChanged = this.config.eventBus.on('filesystem.changed', (event) => {
      // The hexId in the event is the filesystem entity ID
      const filesystemEntityId = event.hexId;

      // Don't react to our own changes
      if (event.data.changedBy === this.agentEntity.id) {
        return;
      }

      // Check if this filesystem is one we have read access to
      if (this.canReadFromFilesystem(filesystemEntityId)) {
        console.log(`[Agent ${this.agentEntity.name}] Filesystem changed event received:`, event.data);
        // Try to start reviewing the changes if we're idle
        this.handleFilesystemChange(event);
      }
    });

    // Check for initial work after a brief delay to let tools initialize
    setTimeout(() => {
      if (this.isRunning()) {
        this.tryClaimTask();
      }
    }, 100);
  }

  /**
   * Override stop to cleanup subscriptions and abort current work
   */
  async stop(): Promise<void> {
    // Set stopped flag FIRST - this persists and is checked by isAborted()
    this.stopped = true;

    // Signal abort to any running work
    if (this.abortController) {
      console.log(`[Agent ${this.agentEntity.name}] Stopping - aborting current LLM call`);
      this.abortController.abort();
      // Don't null out abortController here - let isAborted() still check the signal
    }

    if (this.unsubscribeTasksAvailable) {
      this.unsubscribeTasksAvailable();
      this.unsubscribeTasksAvailable = undefined;
    }
    if (this.unsubscribeUserMessage) {
      this.unsubscribeUserMessage();
      this.unsubscribeUserMessage = undefined;
    }
    if (this.unsubscribeEntityUpdated) {
      this.unsubscribeEntityUpdated();
      this.unsubscribeEntityUpdated = undefined;
    }
    if (this.unsubscribeFilesystemChanged) {
      this.unsubscribeFilesystemChanged();
      this.unsubscribeFilesystemChanged = undefined;
    }
    this.currentWorkItem = null;
    await super.stop();
  }

  /**
   * Check if the agent has been signaled to abort
   * Checks both the stopped flag and the abort controller signal
   */
  private isAborted(): boolean {
    return this.stopped || (this.abortController?.signal.aborted ?? false);
  }

  /**
   * Check if a tool hex is in range of this agent (can provide tools to us)
   */
  private isToolInRange(toolHexKey: string): boolean {
    const state = this.config.store.getState();
    const resources = getResourcesInRange(this.hexKey, state);
    return resources.some(r => r.hexKey === toolHexKey);
  }

  /**
   * Check if we can read from a tasklist at the given hex
   */
  private canReadFromTasklist(toolHexKey: string): boolean {
    const state = this.config.store.getState();
    const toolHex = state.hexes.get(toolHexKey);
    if (!toolHex?.entityId) return false;

    const toolEntity = state.entities.get(toolHex.entityId);
    if (!toolEntity || toolEntity.category !== 'tool') return false;
    if ((toolEntity as ToolEntity).toolType !== 'tasklist') return false;

    // Check READ permission
    const result = checkPermission(this.hexKey, toolEntity, toolHexKey, 'read');
    return result.allowed;
  }

  /**
   * Check if we should react to filesystem changes from a tool.
   * Only agents with READ-ONLY permission (not READ+WRITE) should subscribe.
   * This makes RBAC zones explicitly define the data flow:
   * - Writers (write-only) make changes
   * - Reviewers (read-only) react to changes
   * - R/W agents can do both but don't auto-trigger on changes
   */
  private canReadFromFilesystem(filesystemEntityId: string): boolean {
    const state = this.config.store.getState();

    // Find the hex that contains this filesystem entity
    let filesystemHexKey: string | null = null;
    for (const [hexKey, hex] of state.hexes) {
      if (hex.entityId === filesystemEntityId) {
        filesystemHexKey = hexKey;
        break;
      }
    }
    if (!filesystemHexKey) return false;

    const toolEntity = state.entities.get(filesystemEntityId);
    if (!toolEntity || toolEntity.category !== 'tool') return false;
    if ((toolEntity as ToolEntity).toolType !== 'filesystem') return false;

    // Check if this filesystem is in range of us
    const resources = getResourcesInRange(this.hexKey, state);
    const inRange = resources.some(r => r.entityId === filesystemEntityId);
    if (!inRange) return false;

    // Check READ permission - must have read access
    const readResult = checkPermission(this.hexKey, toolEntity, filesystemHexKey, 'read');
    if (!readResult.allowed) return false;

    // Check WRITE permission - must NOT have write access
    // This ensures only read-only agents react to changes
    const writeResult = checkPermission(this.hexKey, toolEntity, filesystemHexKey, 'write');
    if (writeResult.allowed) {
      console.log(`[Agent ${this.agentEntity.name}] Has R/W access to filesystem, not subscribing to changes`);
      return false;
    }

    return true;
  }

  /**
   * Get all filesystem entity IDs that this agent can access (has any permission to).
   * Used for filtering change tracker output to only relevant filesystems.
   */
  private getAccessibleFilesystemIds(): string[] {
    const state = this.config.store.getState();
    const resources = getResourcesInRange(this.hexKey, state);
    const accessibleIds: string[] = [];

    for (const resource of resources) {
      if (resource.type !== 'filesystem') continue;

      const toolEntity = state.entities.get(resource.entityId);
      if (!toolEntity || toolEntity.category !== 'tool') continue;

      // Check if we have any access (read or write) to this filesystem
      const readResult = checkPermission(this.hexKey, toolEntity, resource.hexKey, 'read');
      const writeResult = checkPermission(this.hexKey, toolEntity, resource.hexKey, 'write');

      if (readResult.allowed || writeResult.allowed) {
        accessibleIds.push(resource.entityId);
      }
    }

    return accessibleIds;
  }

  /**
   * Handle a filesystem change event by creating a work item to review the changes
   */
  private handleFilesystemChange(event: EngineEvent): void {
    if (!this.isRunning()) return;

    // Don't start new work if we're already busy
    if (this.isBusy()) {
      console.log(`[Agent ${this.agentEntity.name}] Busy, ignoring filesystem change event`);
      return;
    }

    const operation = event.data.operation as string;
    const path = event.data.path as string | undefined;
    const sourcePath = event.data.sourcePath as string | undefined;
    const destinationPath = event.data.destinationPath as string | undefined;
    const changedByName = event.data.changedByName as string;

    // Build a description of what changed
    let changeDescription: string;
    if (path) {
      changeDescription = `${operation} at ${path}`;
    } else if (sourcePath && destinationPath) {
      changeDescription = `${operation} from ${sourcePath} to ${destinationPath}`;
    } else {
      changeDescription = `${operation} operation`;
    }

    // Create a work item to review the changes
    const workItem: WorkItem = {
      id: `work-fs-change-${Date.now()}`,
      boardId: this.config.boardId,
      sourceHexId: event.hexId, // The filesystem entity ID
      currentHexId: this.hexId,
      status: 'pending',
      payload: {
        message: `Review filesystem changes: ${changeDescription} (by ${changedByName})`,
        filesystemChange: {
          operation,
          path,
          sourcePath,
          destinationPath,
          changedBy: event.data.changedBy,
          changedByName,
        },
      },
      loopIteration: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log(`[Agent ${this.agentEntity.name}] Starting work to review filesystem change: ${changeDescription}`);
    this.receiveWork(workItem);
  }

  /**
   * Try to claim a task from a tasklist within range (pull-based model)
   * Uses range-based lookup to find all tasklists that can reach this agent
   *
   * Only claims a task if the agent is not already busy - this prevents
   * one agent from grabbing all tasks before others have a chance.
   */
  private tryClaimTask(): void {
    if (!this.isRunning()) return;

    // Don't claim new tasks if we're already busy processing or have work queued
    if (this.isBusy()) {
      return;
    }

    // Find all tool resources that can reach this agent (respects their range settings)
    const state = this.config.store.getState();
    const resources = getResourcesInRange(this.hexKey, state);

    // Filter to tasklist tools only
    for (const resource of resources) {
      const entity = state.entities.get(resource.entityId);
      if (!entity || entity.category !== 'tool') continue;

      const toolEntity = entity as ToolEntity;
      if (toolEntity.toolType !== 'tasklist') continue;

      // Check READ permission (RBAC zones are checked here)
      const permResult = checkPermission(this.hexKey, entity, resource.hexKey, 'read');
      if (!permResult.allowed) {
        console.log(`[Agent ${this.agentEntity.name}] No READ permission for tasklist at ${resource.hexKey} (distance=${resource.distance}): ${permResult.reason}`);
        continue;
      }

      // Try to claim a task from this tasklist's actor
      const toolActor = this.config.boardRunner.getActor(resource.hexKey) as ToolActor | undefined;
      if (!toolActor) continue;

      const task = toolActor.claimNextTask(this.hexKey);
      if (task) {
        // Create work item from claimed task
        const workItem = this.createWorkItemFromTask(task, toolEntity, resource.hexKey);
        this.receiveWork(workItem);
        return; // Only claim one task at a time
      }
    }

    console.log(`[Agent ${this.agentEntity.name}] No tasks available to claim`);
  }

  /**
   * Create a WorkItem from a claimed QueueTask
   */
  private createWorkItemFromTask(task: QueueTask, toolEntity: ToolEntity, toolHexKey: string): WorkItem {
    return {
      id: `work-${toolEntity.id}-${task.id}-${Date.now()}`,
      boardId: this.config.boardId,
      sourceHexId: toolEntity.id,
      currentHexId: this.agentEntity.id,
      status: 'pending',
      payload: {
        task: task.title,
        message: task.title,
        description: task.description,
        priority: task.priority,
        source: 'tasklist',
        taskId: task.id,
        sourceHexKey: toolHexKey,
      },
      loopIteration: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Create a WorkItem from a user prompt submitted via the Thoughts tab
   */
  private createWorkItemFromUserPrompt(message: string): WorkItem {
    return {
      id: `user-prompt-${this.agentEntity.id}-${Date.now()}`,
      boardId: this.config.boardId,
      sourceHexId: this.agentEntity.id,  // User prompt originates from the agent itself
      currentHexId: this.agentEntity.id,
      status: 'pending',
      payload: {
        task: message,
        message: message,
        source: 'user-prompt',
      },
      loopIteration: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  protected async processWorkItem(workItem: WorkItem): Promise<void> {
    console.log(`[Agent ${this.agentEntity.name}] Processing work item: ${workItem.id}`);
    this.emitStatus('active');

    // Create abort controller for this work item
    this.abortController = new AbortController();

    // Track current work item for user message injection
    this.currentWorkItem = workItem;

    // Initialize or restore agent state
    let state: AgentState = workItem.agentState ?? {
      thoughts: [],
      observations: [],
      userMessages: [],
      isComplete: false,
      isStuck: false,
    };
    // Ensure userMessages exists for older work items
    if (!state.userMessages) {
      state.userMessages = [];
    }

    try {
      // No iteration limit - agent runs until completion, stuck, or aborted
      // This allows complex multi-step workflows to complete naturally
      for (let iteration = 0; !state.isComplete && !state.isStuck && !this.isAborted(); iteration++) {
        console.log(`[Agent ${this.agentEntity.name}] Iteration ${iteration + 1}`);

        // Think - call LLM
        const thought = await this.think(workItem, state);

        // Check for abort after LLM call
        if (this.isAborted()) {
          console.log(`[Agent ${this.agentEntity.name}] Aborted during think phase`);
          break;
        }

        state.thoughts.push(thought);

        // Act if needed
        if (thought.requiresAction && thought.action) {
          // For multi-turn conversation history, we need individual observations
          // for each tool call (with their tool call IDs)
          if (thought.action.type === 'multi_tool_call' && thought.toolCalls) {
            // Execute each tool call and create individual observations
            const observations = await this.executeToolCallsWithIds(thought.toolCalls);
            state.observations.push(...observations);
          } else {
            // Single action (complete, delegate, etc.)
            const observation = await this.act(thought.action);
            state.observations.push(observation);
          }

          // Check if action completed the task
          if (thought.action.type === 'complete') {
            state.isComplete = true;
            state.finalResult = thought.action.message;
          }

          // Tool calls do NOT automatically complete the task.
          // The agent loop continues until the LLM explicitly signals completion
          // via [COMPLETE] or returns a text response without tool calls.
          // This allows multi-step workflows where tools are called iteratively.
        }

        // Emit progress with thought content for UI display
        this.emitEvent('hex.progress', {
          iteration: iteration + 1,
          workItemId: workItem.id,
          thought: thought.content,
          action: thought.action?.type,
        });

        // Update work item state
        workItem.agentState = state;
        workItem.loopIteration = iteration + 1;
        this.config.workQueue.update(workItem.id, workItem);

        // Brief pause between iterations
        await this.sleep(100);
      }

      // Complete work item
      if (this.isAborted()) {
        // Agent was stopped - mark as aborted
        console.log(`[Agent ${this.agentEntity.name}] Work item aborted due to board stop`);
        workItem.status = 'failed';
        workItem.result = { error: 'Aborted: Board stopped' };

        // Emit progress event so abort shows in chat/thoughts
        this.emitEvent('hex.progress', {
          iteration: workItem.loopIteration || 0,
          workItemId: workItem.id,
          thought: '[ABORTED] Agent stopped - board was stopped by user',
          action: 'abort',
        });

        // Release task back to queue if it came from a tasklist
        const taskId = workItem.payload?.taskId as string | undefined;
        const sourceHexKey = workItem.payload?.sourceHexKey as string | undefined;
        if (taskId && sourceHexKey) {
          const toolActor = this.config.boardRunner.getActor(sourceHexKey) as ToolActor | undefined;
          if (toolActor) {
            toolActor.releaseTask(taskId);
          }
        }
      } else if (state.isComplete) {
        workItem.status = 'completed';
        workItem.result = { finalResult: state.finalResult };
      } else if (state.isStuck) {
        workItem.status = 'stuck';
      }

      this.config.workQueue.update(workItem.id, workItem);
      this.emitEvent('work.completed', { workItemId: workItem.id, status: workItem.status });

      // If task came from a tasklist, notify completion
      if (workItem.status === 'completed') {
        const taskId = workItem.payload?.taskId as string | undefined;
        const sourceHexKey = workItem.payload?.sourceHexKey as string | undefined;

        console.log(`[Agent ${this.agentEntity.name}] Task completed, checking for tasklist notification. taskId: ${taskId}, sourceHexKey: ${sourceHexKey}`);

        if (taskId && sourceHexKey) {
          // Notify the tasklist that we completed the task
          const toolActor = this.config.boardRunner.getActor(sourceHexKey) as ToolActor | undefined;
          console.log(`[Agent ${this.agentEntity.name}] Got toolActor for ${sourceHexKey}:`, toolActor ? 'found' : 'not found');
          if (toolActor) {
            const completed = toolActor.completeTask(taskId, this.hexKey);
            console.log(`[Agent ${this.agentEntity.name}] completeTask returned:`, completed);
          }
        } else {
          console.log(`[Agent ${this.agentEntity.name}] Task was NOT from a tasklist (no taskId or sourceHexKey)`);
        }

        // Try to claim the next task after a brief delay
        setTimeout(() => {
          if (this.isRunning()) {
            this.tryClaimTask();
          }
        }, 100);
      }

    } catch (error) {
      console.error(`[Agent ${this.agentEntity.name}] Error:`, error);
      workItem.status = 'failed';
      workItem.result = { error: String(error) };
      this.config.workQueue.update(workItem.id, workItem);
      this.emitEvent('error', { error: String(error), workItemId: workItem.id });

      // If task failed, release it back to the queue
      const taskId = workItem.payload?.taskId as string | undefined;
      const sourceHexKey = workItem.payload?.sourceHexKey as string | undefined;
      if (taskId && sourceHexKey) {
        const toolActor = this.config.boardRunner.getActor(sourceHexKey) as ToolActor | undefined;
        if (toolActor) {
          toolActor.releaseTask(taskId);
        }
      }
    } finally {
      // Clear current work item reference and abort controller
      this.currentWorkItem = null;
      this.abortController = null;
    }

    this.emitStatus('idle');
  }

  /** Cache of available tools for this agent */
  private cachedTools: AgentToolDefinition[] | null = null;
  /** Cache of detailed tool information for system prompt */
  private cachedDetailedToolInfo: string | null = null;

  /**
   * Get tools available to this agent from adjacent tool hexes.
   * Uses RBAC-aware discovery via getAgentTools().
   */
  private getTools(): AgentToolDefinition[] {
    if (this.cachedTools === null) {
      const state = this.config.store.getState();
      const { tools, detailedToolInfo } = getAgentTools(this.config.entity.id, state);
      this.cachedTools = tools;
      this.cachedDetailedToolInfo = detailedToolInfo;
    }
    return this.cachedTools;
  }

  /**
   * Get cached detailed tool info (must call getTools() first)
   */
  private getDetailedToolInfo(): string {
    return this.cachedDetailedToolInfo || '';
  }

  /**
   * Invalidate cached tools (call when entity placement changes)
   */
  public invalidateToolCache(): void {
    this.cachedTools = null;
    this.cachedDetailedToolInfo = null;
  }

  /**
   * Number of recent iterations to keep in full detail.
   * Older iterations are summarized to reduce token usage.
   */
  private static readonly FULL_HISTORY_ITERATIONS = 3;

  /**
   * Maximum length for summarized content (thoughts and observations).
   */
  private static readonly SUMMARY_MAX_LENGTH = 200;

  /**
   * Build multi-turn conversation history from agent state.
   *
   * Uses a compaction strategy to reduce token usage:
   * - Recent iterations (last N) are kept in full detail with proper tool call/result pairing
   * - Older iterations are summarized into a compact work log
   *
   * This enables the LLM to see what tool calls it made and what results it got,
   * while keeping token usage bounded as conversations grow.
   */
  private buildConversationHistory(
    systemPrompt: string,
    initialContext: string,
    state: AgentState
  ): LLMMessage[] {
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: initialContext },
    ];

    const totalThoughts = state.thoughts.length;
    const fullHistoryStart = Math.max(0, totalThoughts - AgentActor.FULL_HISTORY_ITERATIONS);

    // If we have older iterations to summarize, add a compact summary
    if (fullHistoryStart > 0) {
      const summary = this.buildHistorySummary(state, 0, fullHistoryStart);
      if (summary) {
        messages.push({
          role: 'user',
          content: summary,
        });
      }
    }

    // Build full detail for recent iterations
    this.appendFullHistoryMessages(messages, state, fullHistoryStart);

    return messages;
  }

  /**
   * Build a compact summary of older iterations.
   * Summarizes thoughts and their outcomes without full tool call details.
   */
  private buildHistorySummary(
    state: AgentState,
    startIndex: number,
    endIndex: number
  ): string | null {
    if (startIndex >= endIndex) return null;

    const summaryLines: string[] = [];
    const userMessages = state.userMessages || [];

    // Build a map of toolCallId -> observation for quick lookup
    const observationMap = new Map<string, Observation>();
    for (const obs of state.observations) {
      if (obs.toolCallId) {
        observationMap.set(obs.toolCallId, obs);
      }
    }

    for (let i = startIndex; i < endIndex; i++) {
      const thought = state.thoughts[i];
      const iterNum = i + 1;

      // Summarize the thought
      const thoughtSummary = this.truncateText(thought.content, AgentActor.SUMMARY_MAX_LENGTH);

      if (thought.toolCalls && thought.toolCalls.length > 0) {
        // Summarize tool calls and their results
        const toolSummaries: string[] = [];
        for (const tc of thought.toolCalls) {
          const obs = observationMap.get(tc.toolCallId);
          const status = obs ? (obs.success ? 'OK' : 'FAILED') : 'pending';
          const resultPreview = obs ? this.truncateText(obs.result, 100) : '';
          toolSummaries.push(`${tc.toolName}(): ${status}${resultPreview ? ' - ' + resultPreview : ''}`);
        }
        summaryLines.push(`[${iterNum}] ${thoughtSummary}`);
        summaryLines.push(`    Tools: ${toolSummaries.join(', ')}`);
      } else {
        summaryLines.push(`[${iterNum}] ${thoughtSummary}`);
      }

      // Include user messages that were injected after this thought
      const messagesAfterThisThought = userMessages.filter(um => um.afterThoughtIndex === i);
      for (const um of messagesAfterThisThought) {
        const userMsgSummary = this.truncateText(um.content, 100);
        summaryLines.push(`    [User]: ${userMsgSummary}`);
      }
    }

    if (summaryLines.length === 0) return null;

    return `## Previous Work Summary (iterations 1-${endIndex})\n\n${summaryLines.join('\n')}\n\n---\nRecent iterations follow with full details:`;
  }

  /**
   * Append full-detail messages for recent iterations.
   * These include proper tool call/result pairing for the LLM.
   */
  private appendFullHistoryMessages(
    messages: LLMMessage[],
    state: AgentState,
    startIndex: number
  ): void {
    // Build interleaved history of assistant responses, tool results, and user messages
    // We need to pair up thoughts with their corresponding observations

    // Build a map of toolCallId -> observation for quick lookup
    const observationMap = new Map<string, Observation>();
    for (const obs of state.observations) {
      if (obs.toolCallId) {
        observationMap.set(obs.toolCallId, obs);
      }
    }

    // Get user messages for easy lookup by afterThoughtIndex
    const userMessages = state.userMessages || [];

    for (let i = startIndex; i < state.thoughts.length; i++) {
      const thought = state.thoughts[i];
      const isLastThought = i === state.thoughts.length - 1;

      // Add assistant message
      if (thought.toolCalls && thought.toolCalls.length > 0) {
        // Assistant made tool calls
        messages.push({
          role: 'assistant',
          content: thought.content,
          toolCalls: thought.toolCalls.map(tc => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.args,
          })),
        });

        // Add tool result messages for each tool call
        for (const tc of thought.toolCalls) {
          const observation = observationMap.get(tc.toolCallId);

          if (observation) {
            messages.push({
              role: 'tool',
              content: observation.result,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
            });
          }
        }
      } else {
        // Simple text response (no tool calls)
        messages.push({
          role: 'assistant',
          content: thought.content,
        });

        // If this thought was a rejected premature completion (contains our rejection message),
        // add a user message to prompt the agent to actually call tools
        if (thought.content.includes('[Agent attempted to complete without calling tools')) {
          messages.push({
            role: 'user',
            content: 'You have not called any tools yet. You MUST call tools to complete this task. ' +
              'Do NOT describe what you would do - actually call the tools now. ' +
              'Do NOT say [COMPLETE] until you have actually performed the work using tool calls.',
          });
        } else if (!isLastThought && !thought.requiresAction) {
          // For other non-action thoughts (not the current one being processed),
          // add a prompt to continue working
          messages.push({
            role: 'user',
            content: 'Continue. Call the appropriate tools to accomplish the task.',
          });
        }
      }

      // Add any user messages that were injected after this thought
      const messagesAfterThisThought = userMessages.filter(um => um.afterThoughtIndex === i);
      for (const um of messagesAfterThisThought) {
        messages.push({
          role: 'user',
          content: `[User guidance]: ${um.content}`,
        });
      }
    }
  }

  /**
   * Truncate text to a maximum length, adding ellipsis if truncated.
   */
  private truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    // Normalize whitespace and remove newlines for summary
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return normalized.substring(0, maxLength - 3) + '...';
  }

  private async think(workItem: WorkItem, state: AgentState): Promise<Thought> {
    const tools = this.getTools();
    const appState = this.config.store.getState();

    // Build dynamic system prompt based on entity type, RBAC, and available tools
    // Include detailed tool info with parameter descriptions from Zod schemas
    const systemPrompt = buildSystemPrompt({
      agentEntity: this.agentEntity,
      availableTools: tools,
      state: appState,
      detailedToolInfo: this.getDetailedToolInfo(),
    });

    const context = this.buildContext(workItem, state);
    const model = this.agentEntity.model || 'gpt-4o-mini';

    // Build multi-turn conversation history
    // This allows the LLM to see its previous tool calls and their results
    const messages = this.buildConversationHistory(systemPrompt, context, state);

    // Debug: Log conversation history structure
    console.log(`[AgentActor] Conversation history (${messages.length} messages):`);
    for (const msg of messages) {
      if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
        console.log(`  - assistant: "${msg.content?.substring(0, 50)}..." + ${msg.toolCalls.length} tool calls: ${msg.toolCalls.map(tc => tc.toolName).join(', ')}`);
      } else if (msg.role === 'tool') {
        const toolMsg = msg as { role: 'tool'; toolName: string; content: string };
        console.log(`  - tool [${toolMsg.toolName}]: ${toolMsg.content.substring(0, 80)}...`);
      } else {
        console.log(`  - ${msg.role}: ${msg.content?.substring(0, 80)}...`);
      }
    }

    // Emit LLM request event with full context for World tab
    this.emitEvent('llm.request', {
      model,
      provider: this.agentEntity.provider || 'mock',
      systemPrompt: systemPrompt.substring(0, 200) + (systemPrompt.length > 200 ? '...' : ''),
      userPrompt: context.substring(0, 500) + (context.length > 500 ? '...' : ''),
      toolCount: tools.length,
      messageCount: messages.length,
      // Full context for World tab - includes complete message history
      fullMessages: messages,
      fullSystemPrompt: systemPrompt,
      toolNames: tools.map(t => t.name),
    });

    try {
      // Use native tool calling via AI SDK
      // Pass provider from entity config to ensure we use the correct LLM provider
      // Pass abort signal to allow graceful interruption of LLM calls
      const provider = (this.agentEntity.provider || 'mock') as LLMProviderType;
      const response = await llmClient.completeWithTools(
        {
          messages,
          model,
          temperature: this.agentEntity.temperature || 0.7,
          abortSignal: this.abortController?.signal,
        },
        tools,
        provider,
        model
      );

      // Emit LLM response event with raw response data
      this.emitEvent('llm.response', {
        model: response.model,
        content: response.content,
        finishReason: response.finishReason,
        toolCalls: response.toolCalls?.map(tc => ({
          name: tc.toolName,
          args: tc.args,
        })),
        usage: response.usage,
        cost: response.cost,
        rawResponse: response.rawResponse,
      });

      // Track accumulated cost for hex height growth
      if (response.cost && response.usage) {
        this.config.store.addEntityCost(
          this.config.entity.id,
          response.cost.totalCost,
          response.usage.totalTokens
        );
        console.log(`[Agent ${this.agentEntity.name}] LLM cost: $${response.cost.totalCost.toFixed(6)}, tokens: ${response.usage.totalTokens}`);
      }

      // Check if LLM made tool calls (native AI SDK handling)
      // Process ALL tool calls in the response, not just the first one
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Build informative content including tool names for the thoughts tab
        const toolNames = response.toolCalls.map(tc => tc.toolName).join(', ');
        const content = response.content || `Calling: ${toolNames}`;

        // Store tool calls with IDs for multi-turn conversation history
        const thoughtToolCalls: ThoughtToolCall[] = response.toolCalls.map(tc => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
        }));

        // Return a special action type that includes all tool calls
        return {
          content,
          requiresAction: true,
          action: {
            type: 'multi_tool_call',
            toolCalls: response.toolCalls.map(tc => ({
              toolName: tc.toolName,
              toolParams: tc.args,
            })),
          },
          timestamp: new Date(),
          // Include tool calls with IDs for conversation history
          toolCalls: thoughtToolCalls,
        };
      }

      // Check for completion signal in text response
      // Enforce that tools must be called before completion to prevent agents from
      // just describing what they would do instead of actually doing it.
      // This is important for complex workflows like drop-in reviewer hexes.
      if (response.content.includes('[COMPLETE]')) {
        // Check if any tool calls have been made by looking at observations
        const hasUsedTools = state.observations.some(
          (obs) => obs.actionType === 'tool_call' || obs.actionType === 'multi_tool_call'
        );

        if (!hasUsedTools && tools.length > 0) {
          // Agent tried to complete without calling any tools - reject and prompt to use tools
          console.log(`[Agent ${this.agentEntity.name}] Attempted to complete without calling tools - rejecting`);
          return {
            content: '[Agent attempted to complete without calling tools - must use tools first]',
            requiresAction: false,
            timestamp: new Date(),
          };
        }

        const content = response.content.replace('[COMPLETE]', '').trim();
        return {
          content,
          requiresAction: true,
          action: { type: 'complete', message: content },
          timestamp: new Date(),
        };
      }

      // If no tools available and LLM stopped naturally, treat as complete
      if (tools.length === 0 && response.finishReason === 'stop') {
        return {
          content: response.content.trim(),
          requiresAction: true,
          action: { type: 'complete', message: response.content.trim() },
          timestamp: new Date(),
        };
      }

      // No tool calls, just a thought
      return {
        content: response.content.trim(),
        requiresAction: false,
        timestamp: new Date(),
      };
    } catch (error) {
      // Check if this is an abort error (user stopped the board)
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
        console.log(`[Agent ${this.agentEntity.name}] LLM call aborted`);
        // Return a special thought that signals abort - the main loop will handle this
        return {
          content: 'LLM call aborted - board stopped',
          requiresAction: false,
          timestamp: new Date(),
        };
      }

      console.error('LLM error:', error);
      // Emit error event
      this.emitEvent('llm.response', {
        error: String(error),
        model,
      });
      return {
        content: `Error calling LLM: ${error}`,
        requiresAction: true,
        action: { type: 'complete', message: 'Completed with error' },
        timestamp: new Date(),
      };
    }
  }

  private buildContext(workItem: WorkItem, state: AgentState): string {
    // User context only contains the task and conversation history
    // All instructions, tool docs, and guidelines are in the system prompt
    let context = `Task: ${JSON.stringify(workItem.payload)}\n\n`;

    // Inject stale file warnings - files this agent read that have been modified by others
    const staleWarnings = filesystemContextManager.formatStaleFilesForPrompt(this.agentEntity.id);
    if (staleWarnings) {
      context += staleWarnings + '\n\n';
    }

    // Inject recent filesystem changes from other agents (only from accessible filesystems)
    const accessibleFilesystemIds = this.getAccessibleFilesystemIds();
    const recentChanges = changeTracker.formatForPrompt(this.agentEntity.id, accessibleFilesystemIds);
    if (recentChanges) {
      context += recentChanges + '\n\n';
    }

    if (state.thoughts.length > 0) {
      context += 'Previous thoughts:\n';
      for (const t of state.thoughts.slice(-3)) {
        context += `- ${t.content}\n`;
      }
    }

    if (state.observations.length > 0) {
      context += '\nRecent observations:\n';
      for (const o of state.observations.slice(-3)) {
        context += `- ${o.actionType}: ${o.result}\n`;
      }
    }

    context += '\nWhat should we do next? If the task is complete, respond with [COMPLETE] followed by a summary of what was accomplished.';
    return context;
  }

  private async act(action: Action): Promise<Observation> {
    switch (action.type) {
      case 'tool_call':
        return this.executeToolCall(action);

      case 'multi_tool_call':
        return this.executeMultiToolCall(action);

      case 'complete':
        return {
          actionType: 'complete',
          success: true,
          result: action.message || 'Task completed',
          timestamp: new Date(),
        };

      case 'delegate':
        // Future: delegate to adjacent agent
        return {
          actionType: 'delegate',
          success: false,
          result: 'Delegation not yet implemented',
          timestamp: new Date(),
        };

      default:
        return {
          actionType: action.type,
          success: false,
          result: `Unknown action type: ${action.type}`,
          timestamp: new Date(),
        };
    }
  }

  /**
   * Execute multiple tool calls from a single LLM response (legacy, returns single observation)
   */
  private async executeMultiToolCall(action: Action): Promise<Observation> {
    const toolCalls = action.toolCalls || [];
    if (toolCalls.length === 0) {
      return {
        actionType: 'multi_tool_call',
        success: false,
        result: 'No tool calls provided',
        timestamp: new Date(),
      };
    }

    console.log(`[Agent ${this.agentEntity.name}] Executing ${toolCalls.length} tool calls`);

    const results: Array<{ tool: string; success: boolean; result: string }> = [];
    let allSuccess = true;

    for (const tc of toolCalls) {
      const singleAction: Action = {
        type: 'tool_call',
        toolName: tc.toolName,
        toolParams: tc.toolParams,
      };
      const observation = await this.executeToolCall(singleAction);
      results.push({
        tool: tc.toolName,
        success: observation.success,
        result: observation.result,
      });
      if (!observation.success) {
        allSuccess = false;
      }
    }

    // Summarize results
    const successCount = results.filter(r => r.success).length;
    const summary = `Executed ${toolCalls.length} tool calls: ${successCount}/${toolCalls.length} succeeded`;

    return {
      actionType: 'multi_tool_call',
      success: allSuccess,
      result: summary,
      timestamp: new Date(),
    };
  }

  /**
   * Execute tool calls with tool call IDs for multi-turn conversation history.
   * Returns individual observations for each tool call, preserving the tool call ID
   * so the LLM can see what each tool returned.
   */
  private async executeToolCallsWithIds(toolCalls: ThoughtToolCall[]): Promise<Observation[]> {
    const observations: Observation[] = [];

    console.log(`[Agent ${this.agentEntity.name}] Executing ${toolCalls.length} tool calls with IDs`);

    for (const tc of toolCalls) {
      const singleAction: Action = {
        type: 'tool_call',
        toolName: tc.toolName,
        toolParams: tc.args,
      };

      const baseObservation = await this.executeToolCall(singleAction);

      // Add tool call ID and tool name to observation for conversation history
      observations.push({
        ...baseObservation,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
      });
    }

    return observations;
  }

  /**
   * Execute a tool call using RBAC-aware tools from getAgentTools()
   * Tool names are namespaced: "filesystem_read_file", "shell_execute", etc.
   */
  private async executeToolCall(action: Action): Promise<Observation> {
    const toolName = action.toolName || '';

    if (!toolName) {
      return {
        actionType: 'tool_call',
        success: false,
        result: 'No tool name provided',
        timestamp: new Date(),
      };
    }

    // Find the tool in our available tools (already RBAC-filtered)
    const tools = this.getTools();
    const tool = tools.find(t => t.name === toolName);

    if (!tool) {
      return {
        actionType: 'tool_call',
        success: false,
        result: `Tool "${toolName}" not available. Available tools: ${tools.map(t => t.name).join(', ')}`,
        timestamp: new Date(),
      };
    }

    console.log(`[Agent ${this.agentEntity.name}] Executing tool: ${toolName}`, action.toolParams);

    // Check if this is a shell tool call - emit shell events for UI
    const isShellTool = toolName.startsWith('shell_');
    // tool.sourceHexId is actually the entity ID (despite the name)
    const shellEntityId: string | null = isShellTool ? tool.sourceHexId : null;

    // Check if this is a filesystem tool
    const isFilesystemTool = toolName.startsWith('filesystem_');
    const filesystemEntityId: string | null = isFilesystemTool ? tool.sourceHexId : null;

    // Filesystem read tools - track these for read-before-write enforcement
    const filesystemReadTools = [
      'filesystem_read_file',
      'filesystem_get_file_info',
    ];
    const isFilesystemReadTool = filesystemReadTools.includes(toolName);

    // Filesystem write tools - emit filesystem.changed events
    const filesystemWriteTools = [
      'filesystem_write_file',
      'filesystem_create_directory',
      'filesystem_delete_file',
      'filesystem_delete_directory',
      'filesystem_copy_file',
      'filesystem_move_file',
    ];
    const isFilesystemWriteTool = filesystemWriteTools.includes(toolName);

    // For filesystem write tools, enforce read-before-write and claim the file
    let claimedFilePath: string | null = null;
    if (isFilesystemWriteTool && filesystemEntityId) {
      const filePath = this.extractFilesystemPath(toolName, action.toolParams || {});
      if (filePath) {
        // Check if file exists - read-before-write only applies to existing files
        // For new files (file doesn't exist), we allow direct creation
        let fileExists = true;
        const fileExistsTool = tools.find(t => t.name === 'filesystem_file_exists');
        if (fileExistsTool) {
          try {
            const existsResult = await fileExistsTool.execute({ path: filePath });
            if (existsResult.success && typeof existsResult.result === 'object' && existsResult.result !== null) {
              const resultObj = existsResult.result as { exists?: boolean };
              fileExists = resultObj.exists ?? true;
            }
          } catch (err) {
            // If we can't check existence, assume file exists (safer default)
            console.log(`[Agent ${this.agentEntity.name}] Could not check file existence, assuming file exists:`, err);
          }
        }

        // Check read-before-write: has the agent read this file first?
        // For new files (fileExists=false), this check passes automatically
        const readCheckResult = filesystemContextManager.checkReadBeforeWrite(
          this.agentEntity.id,
          filesystemEntityId,
          filePath,
          fileExists
        );
        if (!readCheckResult.allowed) {
          return {
            actionType: 'tool_call',
            success: false,
            result: readCheckResult.reason || 'Must read file before writing',
            error: readCheckResult.reason,
            timestamp: new Date(),
          };
        }

        // Claim the file to prevent concurrent writes
        const claimResult = fileReservationManager.claim(
          filePath,
          this.agentEntity.id,
          this.agentEntity.name,
          toolName.replace('filesystem_', '')
        );
        if (!claimResult.success) {
          // File is claimed by another agent
          return {
            actionType: 'tool_call',
            success: false,
            result: claimResult.error || 'File is busy',
            error: claimResult.error,
            timestamp: new Date(),
          };
        }
        claimedFilePath = filePath;
      }
    }

    if (isShellTool) {
      // Emit shell.command.start event
      const command = this.extractShellCommand(toolName, action.toolParams || {});
      this.emitShellEvent('shell.command.start', { command }, shellEntityId);
    }

    try {
      const result = await tool.execute(action.toolParams || {});

      // Release file claim after successful execution
      if (claimedFilePath) {
        fileReservationManager.release(claimedFilePath, this.agentEntity.id);
      }

      // For shell tools, emit output and exit events
      if (isShellTool) {
        if (result.success && result.result) {
          const shellResult = result.result as { stdout?: string; stderr?: string; exitCode?: number };

          if (shellResult.stdout) {
            this.emitShellEvent('shell.command.output', { stream: 'stdout', output: shellResult.stdout }, shellEntityId);
          }
          if (shellResult.stderr) {
            this.emitShellEvent('shell.command.output', { stream: 'stderr', output: shellResult.stderr }, shellEntityId);
          }

          this.emitShellEvent('shell.command.exit', { exitCode: shellResult.exitCode ?? 0 }, shellEntityId);
        } else if (result.error) {
          this.emitShellEvent('shell.command.exit', { exitCode: 1, error: result.error }, shellEntityId);
        }
      }

      // For filesystem read tools, record the read for read-before-write tracking
      if (isFilesystemReadTool && result.success && filesystemEntityId) {
        const filePath = (action.toolParams?.path as string) || '';
        if (filePath) {
          // Use current timestamp as approximate mtime (we could get actual mtime from Tauri)
          filesystemContextManager.recordRead(
            this.agentEntity.id,
            filesystemEntityId,
            filePath,
            Date.now()
          );
        }
      }

      // For filesystem write tools, emit filesystem.changed event
      if (isFilesystemWriteTool && result.success) {
        this.emitFilesystemChangedEvent(toolName, action.toolParams || {}, filesystemEntityId);
      }

      return {
        actionType: 'tool_call',
        success: result.success,
        result: result.success
          ? JSON.stringify(result.result)
          : `Tool error: ${result.error}`,
        error: result.error,
        timestamp: new Date(),
      };
    } catch (error) {
      // Release file claim on error
      if (claimedFilePath) {
        fileReservationManager.release(claimedFilePath, this.agentEntity.id);
      }

      // For shell tools, emit error exit event
      if (isShellTool) {
        this.emitShellEvent('shell.command.exit', { exitCode: 1, error: String(error) }, shellEntityId);
      }

      return {
        actionType: 'tool_call',
        success: false,
        result: `Tool execution failed: ${error}`,
        error: String(error),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Extract shell command string from tool call for display
   */
  private extractShellCommand(toolName: string, params: Record<string, unknown>): string {
    if (toolName === 'shell_execute') {
      return (params.command as string) || 'unknown command';
    } else if (toolName === 'shell_execute_script') {
      const interpreter = (params.interpreter as string) || 'bash';
      const scriptPreview = ((params.script as string) || '').substring(0, 50);
      return `${interpreter} -c "${scriptPreview}${scriptPreview.length >= 50 ? '...' : ''}"`;
    }
    return 'shell command';
  }

  /**
   * Extract file path from filesystem tool call for reservation
   */
  private extractFilesystemPath(toolName: string, params: Record<string, unknown>): string | null {
    switch (toolName) {
      case 'filesystem_write_file':
      case 'filesystem_delete_file':
      case 'filesystem_create_directory':
      case 'filesystem_delete_directory':
        return (params.path as string) || null;
      case 'filesystem_copy_file':
      case 'filesystem_move_file':
        // For copy/move, we claim the destination
        return (params.destination as string) || null;
      default:
        return null;
    }
  }

  /**
   * Emit shell event to both agent entity and shell entity
   * All events use entity UUIDs for hexId (not hex coordinate keys)
   */
  private emitShellEvent(
    type: 'shell.command.start' | 'shell.command.output' | 'shell.command.exit',
    data: Record<string, unknown>,
    shellEntityId: string | null
  ): void {
    // Emit for agent entity (uses entity UUID via this.emitEvent -> this.hexId)
    this.emitEvent(type, data);

    // Also emit for shell entity so it shows in shell's terminal view
    if (shellEntityId && shellEntityId !== this.hexId) {
      this.config.eventBus.emit({
        type,
        hexId: shellEntityId,  // Entity UUID, not hex key
        boardId: this.config.boardId,
        data,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Emit filesystem.changed event when a filesystem write operation completes.
   * This allows adjacent agents with read permission to react to file changes.
   */
  private emitFilesystemChangedEvent(
    toolName: string,
    params: Record<string, unknown>,
    filesystemEntityId: string | null
  ): void {
    // Determine the operation type and affected path(s)
    let operation: string;
    let path: string | undefined;
    let sourcePath: string | undefined;
    let destinationPath: string | undefined;

    switch (toolName) {
      case 'filesystem_write_file':
        operation = 'write';
        path = params.path as string;
        break;
      case 'filesystem_create_directory':
        operation = 'create_directory';
        path = params.path as string;
        break;
      case 'filesystem_delete_file':
        operation = 'delete';
        path = params.path as string;
        break;
      case 'filesystem_delete_directory':
        operation = 'delete_directory';
        path = params.path as string;
        break;
      case 'filesystem_copy_file':
        operation = 'copy';
        sourcePath = params.source as string;
        destinationPath = params.destination as string;
        break;
      case 'filesystem_move_file':
        operation = 'move';
        sourcePath = params.source as string;
        destinationPath = params.destination as string;
        break;
      default:
        operation = 'unknown';
    }

    const eventData: Record<string, unknown> = {
      operation,
      changedBy: this.agentEntity.id,
      changedByName: this.agentEntity.name,
      changedByTemplate: this.agentEntity.template,
    };

    if (path) {
      eventData.path = path;
    }
    if (sourcePath) {
      eventData.sourcePath = sourcePath;
    }
    if (destinationPath) {
      eventData.destinationPath = destinationPath;
    }

    // Emit for the filesystem entity so adjacent agents can react
    if (filesystemEntityId) {
      this.config.eventBus.emit({
        type: 'filesystem.changed',
        hexId: filesystemEntityId,
        boardId: this.config.boardId,
        data: eventData,
        timestamp: new Date(),
      });
      console.log(`[Agent ${this.agentEntity.name}] Emitted filesystem.changed event:`, eventData);
    }
  }
}

