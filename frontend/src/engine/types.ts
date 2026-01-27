/**
 * Core types for the local execution engine
 */

// Work item status
export type WorkItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'stuck';

// Work item flowing through the board
export interface WorkItem {
  id: string;
  boardId: string;
  sourceHexId: string;
  currentHexId: string;
  status: WorkItemStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  loopIteration: number;
  agentState?: AgentState;
  createdAt: Date;
  updatedAt: Date;
}

// User message injected into agent conversation
export interface UserMessage {
  content: string;
  timestamp: Date;
  // Index in thoughts array after which this message was injected
  afterThoughtIndex: number;
}

// Agent reasoning state
export interface AgentState {
  thoughts: Thought[];
  observations: Observation[];
  userMessages: UserMessage[];  // User messages injected via UI
  isComplete: boolean;
  isStuck: boolean;
  finalResult?: string;
}

// Single thought in agent reasoning
export interface Thought {
  content: string;
  requiresAction: boolean;
  action?: Action;
  timestamp: Date;
  // Tool calls made by this thought (includes tool call IDs for multi-turn conversation)
  toolCalls?: ThoughtToolCall[];
}

// Tool call from a thought (with ID for multi-turn conversation)
export interface ThoughtToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// Single tool call in a multi-tool action
export interface ToolCallInfo {
  toolName: string;
  toolParams?: Record<string, unknown>;
}

// Action the agent wants to take
export interface Action {
  type: 'tool_call' | 'multi_tool_call' | 'delegate' | 'complete' | 'escalate';
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolCalls?: ToolCallInfo[];  // For multi_tool_call actions
  targetHexId?: string;
  message?: string;
}

// Result of an action
export interface Observation {
  actionType: string;
  success: boolean;
  result: string;
  error?: string;
  timestamp: Date;
  // Tool call ID this observation is a result of (for multi-turn conversation)
  toolCallId?: string;
  toolName?: string;
}

// Event emitted by actors
export interface EngineEvent {
  type:
    | 'hex.status'
    | 'hex.progress'
    | 'work.received'
    | 'work.completed'
    | 'work.flowing'
    | 'cost.updated'
    | 'llm.request'
    | 'llm.response'
    | 'entity.updated'
    | 'error'
    | 'board.starting'
    | 'board.started'
    | 'board.stopping'
    | 'board.stopped'
    | 'board.error'
    | 'board.loaded'
    // Budget events
    | 'budget.exceeded'
    | 'budget.updated'
    | 'budget.limits.updated'
    // Task queue events (pull-based model)
    | 'task.added'
    | 'tasks.available'
    | 'task.claimed'
    | 'task.completed'
    | 'task.released'
    // Shell command events
    | 'shell.command.start'
    | 'shell.command.output'
    | 'shell.command.exit'
    // Filesystem change events
    | 'filesystem.changed'
    // User message injection
    | 'user.message';
  hexId: string;
  boardId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

// Actor interface - each hex type implements this
export interface HexActor {
  hexId: string;
  hexKey: string; // q,r coordinate key
  
  // Start the actor's event loop
  start(): Promise<void>;
  
  // Stop the actor gracefully
  stop(): Promise<void>;
  
  // Receive a work item for processing
  receiveWork(workItem: WorkItem): void;
  
  // Check if the actor is running
  isRunning(): boolean;
}

// LLM message format
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// LLM completion request
export interface LLMRequest {
  messages: LLMMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// LLM completion response
export interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
}

// MCP tool definition
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// MCP tool call result
export interface MCPToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

