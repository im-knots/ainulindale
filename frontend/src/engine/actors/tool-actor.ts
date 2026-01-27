/**
 * ToolActor - Handles tool entities (filesystem, shell, tasklist)
 *
 * Tools provide capabilities to adjacent agents:
 * - filesystem: read/write files
 * - shell: execute commands
 * - tasklist: manage tasks from markdown files
 *
 * Tasklist tools act as input queues. Adjacent agents with read permission
 * can claim tasks from the queue. Tasks are marked as "processing" until
 * the agent completes or times out, preventing duplicate work.
 */

import { BaseActor, ActorConfig } from './base-actor';
import { WorkItem } from '../types';
import { ToolEntity } from '../../state/store';

/**
 * Task in the queue with status tracking
 */
export interface QueueTask {
  id: string;
  title: string;
  description?: string;
  priority: string;
  status: 'pending' | 'processing' | 'completed';
  claimedBy?: string;           // hexKey of agent that claimed it
  claimedByEntityId?: string;   // entity UUID of agent that claimed it
  claimedByName?: string;       // name of agent that claimed it (for display)
  claimedAt?: Date;             // for timeout tracking
}

// Default timeout: 5 minutes (configurable via settings later)
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

export class ToolActor extends BaseActor {
  private toolEntity: ToolEntity;

  // Task queue with full state tracking
  private taskQueue: QueueTask[] = [];
  private unsubscribeEvents?: () => void;
  private taskIdCounter = 0; // For generating unique task IDs
  private timeoutCheckInterval?: ReturnType<typeof setInterval>;

  constructor(config: ActorConfig) {
    super(config);
    this.toolEntity = config.entity as ToolEntity;
  }

  /**
   * Override start to initialize task queue and subscribe to events
   */
  async start(): Promise<void> {
    await super.start();

    // Tasklist tools initialize queue and start timeout checker
    if (this.toolEntity.toolType === 'tasklist') {
      this.initializeTaskQueue();

      // Start periodic timeout checker (every 30 seconds)
      this.timeoutCheckInterval = setInterval(() => {
        this.releaseTimedOutTasks();
      }, 30000);

      // Subscribe to entity.updated events to handle new tasks added dynamically
      this.unsubscribeEvents = this.config.eventBus.on('entity.updated', (event) => {
        if (event.data.entityId === this.toolEntity.id) {
          this.handleEntityUpdated(event);
        }
      });

      // Emit event so agents know tasks are available
      if (this.getAvailableTaskCount() > 0) {
        this.emitEvent('tasks.available', {
          toolHexKey: this.hexKey,
          count: this.getAvailableTaskCount(),
        });
      }
    }
  }

  /**
   * Override stop to cleanup event subscriptions and intervals
   */
  async stop(): Promise<void> {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = undefined;
    }
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
      this.timeoutCheckInterval = undefined;
    }
    await super.stop();
  }

  /**
   * Handle entity updates - check for new tasks and add them
   */
  private handleEntityUpdated(_event: import('../types').EngineEvent): void {
    console.log(`[Tool ${this.toolEntity.name}] Entity updated, checking for new tasks...`);

    // Refresh the toolEntity reference to get updated config
    const entity = this.config.store.getState().entities.get(this.toolEntity.id);
    if (entity && entity.category === 'tool') {
      this.toolEntity = entity as ToolEntity;
    }

    // Get all tasks from current config
    const allTasks = this.getTasksFromConfig();

    // Find new tasks that aren't already in the queue (by title match since IDs are generated)
    const existingTitles = new Set(this.taskQueue.map(t => t.title));
    const newTasks = allTasks.filter(task => !existingTitles.has(task.title));

    if (newTasks.length > 0) {
      console.log(`[Tool ${this.toolEntity.name}] Found ${newTasks.length} new task(s), adding to queue`);
      this.taskQueue.push(...newTasks);

      // Emit event so agents know tasks are available
      this.emitEvent('tasks.available', {
        toolHexKey: this.hexKey,
        count: this.getAvailableTaskCount(),
      });
    }
  }

  /**
   * Initialize the task queue from config
   */
  private initializeTaskQueue(): void {
    this.taskQueue = this.getTasksFromConfig();
    console.log(`[Tool ${this.toolEntity.name}] Task queue initialized with ${this.taskQueue.length} task(s)`);
  }

  /**
   * Get count of available (pending) tasks
   */
  getAvailableTaskCount(): number {
    return this.taskQueue.filter(t => t.status === 'pending').length;
  }

  /**
   * Claim the next available task for an agent (pull-based)
   * Returns null if no tasks available or agent doesn't have permission
   */
  claimNextTask(agentHexKey: string): QueueTask | null {
    // Find the next pending task
    const task = this.taskQueue.find(t => t.status === 'pending');
    if (!task) {
      console.log(`[Tool ${this.toolEntity.name}] No pending tasks for agent at ${agentHexKey}`);
      return null;
    }

    // Look up agent entity info
    const agentInfo = this.getAgentInfoFromHexKey(agentHexKey);

    // Mark as claimed with full agent identity
    task.status = 'processing';
    task.claimedBy = agentHexKey;
    task.claimedByEntityId = agentInfo?.entityId;
    task.claimedByName = agentInfo?.name;
    task.claimedAt = new Date();

    console.log(`[Tool ${this.toolEntity.name}] Task "${task.title}" claimed by ${agentInfo?.name || agentHexKey}`);

    // Emit event for UI updates
    this.emitEvent('task.claimed', {
      taskId: task.id,
      taskTitle: task.title,
      claimedBy: agentHexKey,
      claimedByEntityId: agentInfo?.entityId,
      claimedByName: agentInfo?.name,
    });

    return task;
  }

  /**
   * Complete a task (called when agent finishes)
   */
  completeTask(taskId: string, agentHexKey: string): boolean {
    const task = this.taskQueue.find(t => t.id === taskId);
    if (!task) {
      console.log(`[Tool ${this.toolEntity.name}] Task ${taskId} not found`);
      return false;
    }

    if (task.claimedBy !== agentHexKey) {
      console.log(`[Tool ${this.toolEntity.name}] Task ${taskId} not claimed by ${agentHexKey}`);
      return false;
    }

    task.status = 'completed';
    console.log(`[Tool ${this.toolEntity.name}] Task "${task.title}" completed by agent at ${agentHexKey}`);

    // Mark the task as completed in the UI/store
    this.markTaskCompletedInStore(task.title);

    // Look up agent entity info for UI display
    const agentInfo = this.getAgentInfoFromHexKey(agentHexKey);

    // Emit completion event
    this.emitEvent('task.completed', {
      taskId: task.id,
      taskTitle: task.title,
      completedBy: agentHexKey,
      completedByEntityId: agentInfo?.entityId,
      completedByName: agentInfo?.name,
    });

    return true;
  }

  /**
   * Release a task back to pending (e.g., agent failed/stopped)
   */
  releaseTask(taskId: string): boolean {
    const task = this.taskQueue.find(t => t.id === taskId);
    if (!task || task.status !== 'processing') {
      return false;
    }

    const previousAgent = task.claimedByName || task.claimedBy;
    const taskTitle = task.title;
    task.status = 'pending';
    task.claimedBy = undefined;
    task.claimedByEntityId = undefined;
    task.claimedByName = undefined;
    task.claimedAt = undefined;

    console.log(`[Tool ${this.toolEntity.name}] Task "${taskTitle}" released (was claimed by ${previousAgent})`);

    // Emit task.released event for UI to clear claim status
    this.emitEvent('task.released', {
      taskId: task.id,
      taskTitle: taskTitle,
      previousAgent: previousAgent,
    });

    // Emit event so agents know a task is available
    this.emitEvent('tasks.available', {
      toolHexKey: this.hexKey,
      count: this.getAvailableTaskCount(),
    });

    return true;
  }

  /**
   * Release tasks that have been processing for too long
   */
  private releaseTimedOutTasks(): void {
    const now = Date.now();
    let releasedCount = 0;

    for (const task of this.taskQueue) {
      if (task.status === 'processing' && task.claimedAt) {
        const elapsed = now - task.claimedAt.getTime();
        if (elapsed > DEFAULT_TASK_TIMEOUT_MS) {
          console.log(`[Tool ${this.toolEntity.name}] Task "${task.title}" timed out after ${Math.round(elapsed / 1000)}s`);
          this.releaseTask(task.id);
          releasedCount++;
        }
      }
    }

    if (releasedCount > 0) {
      console.log(`[Tool ${this.toolEntity.name}] Released ${releasedCount} timed-out task(s)`);
    }
  }

  /**
   * Get queue status for UI display
   */
  getQueueStatus(): { pending: number; processing: number; completed: number; tasks: QueueTask[] } {
    const pending = this.taskQueue.filter(t => t.status === 'pending').length;
    const processing = this.taskQueue.filter(t => t.status === 'processing').length;
    const completed = this.taskQueue.filter(t => t.status === 'completed').length;
    return { pending, processing, completed, tasks: [...this.taskQueue] };
  }

  /**
   * Get all tasks in the queue (for tool provider)
   */
  getTasks(): QueueTask[] {
    return [...this.taskQueue];
  }

  /**
   * Get a specific task by ID (for tool provider)
   */
  getTask(taskId: string): QueueTask | undefined {
    return this.taskQueue.find(t => t.id === taskId);
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    this.taskIdCounter++;
    return `task-${this.toolEntity.id}-${Date.now()}-${this.taskIdCounter}`;
  }

  /**
   * Get agent entity info from hex key for UI display
   */
  private getAgentInfoFromHexKey(hexKey: string): { entityId: string; name: string } | null {
    const state = this.config.store.getState();
    const hex = state.hexes.get(hexKey);
    if (!hex?.entityId) return null;

    const entity = state.entities.get(hex.entityId);
    if (!entity) return null;

    return {
      entityId: entity.id,
      name: entity.name,
    };
  }

  /**
   * Get tasks from tool config as QueueTask objects
   * Supports:
   * - UI format: tasks as { text: string, completed: boolean }[]
   * - Simple format: tasks as string[]
   * - Object format: tasks as { title/task: string, priority?: string }[]
   * - Markdown content string
   */
  private getTasksFromConfig(): QueueTask[] {
    const config = this.toolEntity.config as Record<string, unknown>;

    // Check for inline tasks first (for testing and UI-based setups)
    if (Array.isArray(config.tasks)) {
      const tasks: QueueTask[] = [];

      for (let i = 0; i < config.tasks.length; i++) {
        const task = config.tasks[i];

        // Skip completed tasks
        if (typeof task === 'object' && task !== null) {
          const t = task as Record<string, unknown>;
          if (t.completed === true) continue;
        }

        if (typeof task === 'string') {
          tasks.push({
            id: this.generateTaskId(),
            title: task,
            priority: 'normal',
            status: 'pending',
          });
        } else if (typeof task === 'object' && task !== null) {
          const t = task as Record<string, unknown>;
          const title = String(t.title ?? '');
          if (title) {
            tasks.push({
              id: t.id ? String(t.id) : this.generateTaskId(),
              title,
              description: t.description ? String(t.description) : undefined,
              priority: String(t.priority ?? 'normal'),
              status: 'pending',
            });
          }
        }
      }

      return tasks;
    }

    // Check for content string (markdown format for browser mode)
    if (typeof config.content === 'string') {
      return this.parseMarkdownTasks(config.content);
    }

    // Fallback: no tasks available in browser mode without file access
    console.log(`[Tool ${this.toolEntity.name}] No inline tasks or content. Add tasks in the panel.`);
    return [];
  }

  /**
   * Parse markdown checkbox tasks
   */
  private parseMarkdownTasks(content: string): QueueTask[] {
    const tasks: QueueTask[] = [];
    const lines = content.split('\n');
    const taskRegex = /^[-*]\s+\[\s*\]\s+(.+)$/;  // Match unchecked tasks: - [ ] or * [ ]

    for (const line of lines) {
      const match = line.match(taskRegex);
      if (match) {
        const title = match[1].trim();
        const priorityMatch = title.match(/@priority:(\w+)/);
        const priority = priorityMatch ? priorityMatch[1] : 'normal';
        const cleanTitle = title.replace(/@\w+(?::\w+)?/g, '').trim();

        tasks.push({
          id: this.generateTaskId(),
          title: cleanTitle,
          priority,
          status: 'pending',
        });
      }
    }

    return tasks;
  }

  protected async processWorkItem(workItem: WorkItem): Promise<void> {
    // Tools don't process work directly - they provide capabilities to agents
    // However, tasklist tools can receive completed work items as acknowledgments
    if (this.toolEntity.toolType === 'tasklist') {
      this.emitStatus('active');

      // Log what we received
      const status = workItem.status || 'unknown';
      const message = workItem.payload?.message || 'Unknown task';
      console.log(`[Tool ${this.toolEntity.name}] Received ${status} work: ${message}`);

      // If work is completed, use the new pull-based completion method
      if (workItem.status === 'completed') {
        const taskId = workItem.payload?.taskId as string | undefined;
        const completedByHexKey = workItem.payload?.completedByHexKey as string | undefined;

        if (taskId && completedByHexKey) {
          this.completeTask(taskId, completedByHexKey);
        }

        // Emit completion event
        this.emitEvent('work.completed', {
          workItemId: workItem.id,
          result: workItem.result,
        });
      }

      this.emitStatus('idle');
      // Do NOT route to adjacent - that would create a loop
    } else {
      // Filesystem and shell tools don't process work - they're used by agents
      console.log(`[Tool ${this.toolEntity.name}] Tool doesn't process work directly`);
    }
  }

  /**
   * Mark a task as completed in the store (for UI sync)
   */
  private markTaskCompletedInStore(taskTitle: string): void {
    // IMPORTANT: Get fresh entity from store, not cached this.toolEntity which may be stale
    const freshEntity = this.config.store.getState().entities.get(this.toolEntity.id);
    if (!freshEntity || freshEntity.category !== 'tool') {
      console.error(`[Tool ${this.toolEntity.name}] Could not find entity in store for marking task completed`);
      return;
    }

    const config = freshEntity.config as { tasks?: Array<{ title: string; description?: string; completed: boolean }> };
    const tasks = config.tasks || [];

    console.log(`[Tool ${this.toolEntity.name}] markTaskCompletedInStore: Looking for task "${taskTitle}" in ${tasks.length} tasks`);

    // Find the task by title
    const taskIndex = tasks.findIndex(t => t.title === taskTitle);

    if (taskIndex >= 0) {
      // Update the task in the store
      const updatedTasks = [...tasks];
      updatedTasks[taskIndex] = { ...updatedTasks[taskIndex], completed: true };

      console.log(`[Tool ${this.toolEntity.name}] Calling store.updateEntity with updated tasks:`, updatedTasks);

      this.config.store.updateEntity(this.toolEntity.id, {
        config: { ...freshEntity.config, tasks: updatedTasks }
      });

      console.log(`[Tool ${this.toolEntity.name}] Marked task "${tasks[taskIndex].title}" as completed in store`);
    } else {
      console.warn(`[Tool ${this.toolEntity.name}] Task "${taskTitle}" not found in store tasks:`, tasks.map(t => t.title));
    }
  }

  /**
   * Add a new task to the queue (for agents with WRITE permission)
   * Returns the created task or null if failed
   */
  addTask(title: string, description?: string, priority?: string): QueueTask | null {
    if (this.toolEntity.toolType !== 'tasklist') {
      console.log(`[Tool ${this.toolEntity.name}] Cannot add tasks - not a tasklist tool`);
      return null;
    }

    const task: QueueTask = {
      id: this.generateTaskId(),
      title,
      description,
      priority: priority || 'normal',
      status: 'pending',
    };

    this.taskQueue.push(task);
    console.log(`[Tool ${this.toolEntity.name}] Task "${title}" added to queue`);

    // Also add to the store for UI persistence
    const config = this.toolEntity.config as { tasks?: { title: string; description?: string; completed: boolean }[] };
    const tasks = config.tasks || [];
    tasks.push({ title, description, completed: false });
    this.config.store.updateEntity(this.toolEntity.id, {
      config: { ...this.toolEntity.config, tasks }
    });

    // Emit event so agents know a task is available
    this.emitEvent('tasks.available', {
      toolHexKey: this.hexKey,
      count: this.getAvailableTaskCount(),
    });

    // Emit task.added event for UI stats tracking
    this.emitEvent('task.added', {
      toolHexKey: this.hexKey,
      taskId: task.id,
      title: task.title,
    });

    return task;
  }

  /**
   * Execute a tool operation (called by agents)
   */
  async executeTool(operation: string, params: Record<string, unknown>): Promise<unknown> {
    this.emitStatus('active');

    try {
      switch (this.toolEntity.toolType) {
        case 'filesystem':
          return await this.executeFilesystemOp(operation, params);
        case 'shell':
          return await this.executeShellOp(operation, params);
        case 'tasklist':
          return await this.executeTasklistOp(operation, params);
        default:
          throw new Error(`Unknown tool type: ${this.toolEntity.toolType}`);
      }
    } finally {
      this.emitStatus('idle');
    }
  }

  private async executeFilesystemOp(operation: string, params: Record<string, unknown>): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core');
    
    switch (operation) {
      case 'read':
        return await invoke('read_file', { path: params.path as string });
      case 'write':
        return await invoke('write_file', { 
          path: params.path as string, 
          contents: params.contents as string 
        });
      case 'list':
        return await invoke('list_directory', { path: params.path as string });
      default:
        throw new Error(`Unknown filesystem operation: ${operation}`);
    }
  }

  private async executeShellOp(operation: string, params: Record<string, unknown>): Promise<unknown> {
    const { invoke } = await import('@tauri-apps/api/core');
    
    switch (operation) {
      case 'execute':
        return await invoke('execute_shell', { 
          command: params.command as string,
          cwd: params.cwd as string | undefined
        });
      default:
        throw new Error(`Unknown shell operation: ${operation}`);
    }
  }

  private async executeTasklistOp(operation: string, params: Record<string, unknown>): Promise<unknown> {
    // Tasklist operations are handled via the tasklist provider
    console.log(`[Tasklist] Operation: ${operation}`, params);
    
    switch (operation) {
      case 'list':
        // Return current tasks
        return { tasks: [] }; // TODO: Implement via TaskListProvider
      case 'add':
        // Add a new task
        return { success: true };
      case 'complete':
        // Mark task as complete
        return { success: true };
      default:
        throw new Error(`Unknown tasklist operation: ${operation}`);
    }
  }
}

