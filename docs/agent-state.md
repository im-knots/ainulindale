# Agent State and Chain of Thought

Ainulindale maintains **application-level state** for each agent as it processes work items. This state captures the agent's reasoning history, enabling multi-turn conversations with the LLM and providing visibility into the agent's decision-making process.

## Why Application-Level State?

LLMs are stateless - each API call is independent. To enable complex multi-step workflows, Ainulindale:

- **Tracks reasoning history** - Every thought and observation is recorded
- **Builds conversation context** - Previous interactions are replayed to the LLM
- **Enables interruption** - Work can be paused and resumed with full context
- **Provides transparency** - Users can see exactly how the agent reached its conclusions

## Agent State Structure

Each work item carries an agent state that accumulates as the agent works:

| Field | Purpose |
|-------|---------|
| **Thoughts** | The agent's reasoning at each iteration |
| **Observations** | Results from tool calls and actions |
| **User Messages** | Guidance injected by users during execution |
| **Is Complete** | Whether the agent has signaled task completion |
| **Is Stuck** | Whether the agent cannot make progress |
| **Final Result** | The completion message when finished |

## The Chain of Thought

As the agent iterates through its think-act-observe loop, it builds a chain of thought:

### Thoughts

Each thought captures what the agent decided at a given iteration:

| Property | Description |
|----------|-------------|
| **Content** | The agent's reasoning text |
| **Requires Action** | Whether the thought leads to an action |
| **Action** | The action to take (tool call, complete, delegate) |
| **Tool Calls** | Specific tools invoked with their parameters |
| **Timestamp** | When the thought occurred |

### Observations

Each observation records the result of an action:

| Property | Description |
|----------|-------------|
| **Action Type** | What kind of action was taken |
| **Success** | Whether the action succeeded |
| **Result** | The output or response from the action |
| **Error** | Error message if the action failed |
| **Tool Call ID** | Links back to the specific tool call |
| **Timestamp** | When the observation was recorded |

## Multi-Turn Conversation

The agent state enables true multi-turn conversations with the LLM. On each iteration:

1. **System prompt** is generated dynamically (see [System Prompt Generation](./system-prompt-generation.md))
2. **Initial context** provides the task, warnings, and injected context
3. **Conversation history** replays all previous thoughts and observations
4. **LLM responds** with new reasoning and tool calls

This means the LLM sees the full history of what it has done, including:
- Previous reasoning and decisions
- Tool calls it made and their results
- Any user guidance that was injected

## Context Construction

Each LLM call receives carefully constructed context from multiple sources. This context augments the agent's reasoning with real-time information about the codebase and other agents' activities.

### Dynamic System Prompt

The system prompt is rebuilt on every iteration based on:

| Source | What It Provides |
|--------|------------------|
| **Environment** | Date, platform, workspace path, shell type |
| **Available Tools** | Tools the agent can use based on RBAC |
| **Role Guidelines** | Template-specific instructions (Planner, Coder, Reviewer) |
| **Rulefiles** | Equipped rule sets for coding standards, patterns |
| **Custom Instructions** | User-provided additions |

See [System Prompt Generation](./system-prompt-generation.md) for details.

### RAG-Powered Codebase Search

Agents can search the codebase using natural language queries via the `codebase_search` tool. When an agent calls this tool:

1. **Query is embedded** - The search query is converted to a vector
2. **Similarity search** - The vector store finds semantically similar code chunks
3. **Results returned** - Matching code with file paths and line numbers
4. **Agent reasons** - The agent incorporates results into its next thought

This enables agents to find relevant code without knowing exact file names or function signatures. See [Codebase Indexer and RAG System](./indexer.md) for details on how indexing works.

### Filesystem Change Injection

When building context, the agent receives information about recent filesystem changes:

| Injection | Purpose |
|-----------|---------|
| **Stale File Warnings** | Files the agent previously read that have been modified by other agents |
| **Recent Changes** | Files recently modified by other agents in accessible filesystems |

This context is injected into the user message before the task, formatted as:

```
## Stale File Warning
The following files you previously read have been modified:
- src/utils.ts: modified by coder (2m ago)

## Recent Filesystem Changes
Other agents have recently modified files in your workspace:
- src/api.ts: written by coder <abc123> (5m ago)
```

This enables agents to:
- **Avoid conflicts** - Know what other agents are working on
- **Re-read stale files** - Refresh context before making changes
- **Coordinate implicitly** - React to changes without explicit messaging

### Conversation History Replay

The conversation history is replayed to the LLM on each iteration, using a **compaction strategy** to keep token usage bounded:

**Recent iterations (last 3)** are replayed in full detail:
- Assistant message with reasoning and tool calls
- Tool results as tool response messages
- Any user guidance injected after that thought

**Older iterations** are summarized into a compact work log:
- Truncated thought content (max 200 chars)
- Tool call names with success/failure status
- Brief result previews (max 100 chars)

This compaction ensures:
- The LLM sees full detail for recent work (proper tool call/result pairing)
- Older context is preserved but doesn't grow token usage linearly
- Long-running agents remain cost-effective

The LLM still has context of:
- What it decided previously (summarized for older iterations)
- What tools it called and their results
- What guidance the user provided
- What other agents have been doing

## Tool Call Tracking

When an agent calls tools, each call is tracked with a unique ID:

1. **Agent requests tool calls** - LLM returns one or more tool calls with IDs
2. **Tools execute** - Each tool runs and produces a result
3. **Results are recorded** - Observations link back to their tool call IDs
4. **History is rebuilt** - On next iteration, tool calls and results are paired correctly

This enables:
- **Parallel tool calls** - Multiple tools can run simultaneously
- **Accurate history** - Results are matched to the correct tool calls
- **Error attribution** - Failures are linked to specific tool invocations

## User Prompts and Guidance

Users can interact with agents via the **Thoughts** tab chat interface. The behavior depends on whether the agent is idle or busy:

### Idle Agent - New Task

When an agent is idle and receives a user prompt:

1. **User sends prompt** via the Thoughts tab input field
2. **Agent creates work item** with the prompt as the task
3. **Agent starts processing** the new task immediately
4. **Chain of thought begins** with the user's prompt as the initial task

This allows you to give agents ad-hoc tasks directly, without using a tasklist.

### Busy Agent - Guidance Injection

When an agent is already working on a task:

1. **User sends guidance** via the Thoughts tab
2. **Message is recorded** with the current thought index
3. **Next iteration** includes the message in conversation history as `[User guidance]: ...`
4. **Agent responds** to the guidance in its next thought

This allows real-time steering of agent behavior without stopping the workflow. Use this to:
- Provide hints when the agent is stuck
- Correct course if the agent is going in the wrong direction
- Add context the agent might be missing

## State Persistence

Agent state is stored within the work item for the lifetime of the task:

- **During execution** - State updates after each iteration
- **On pause** - State is preserved for later resumption
- **On completion** - Final state is retained for review

This means:
- Work can be interrupted and resumed starting at the last tassk
- Completed work items do not bloat the context
- Short throw zero shot task execution capabilities are better than long lived stateful agents

## Viewing Agent State

When you select an agent hex, the **Detail Bar** appears at the bottom of the screen with several tabs:

| Tab | What It Shows |
|-----|---------------|
| **Thoughts** | Chat-style conversation view with user messages and agent responses. Toggle "Show Thoughts" to see internal reasoning. Includes input field to send guidance to the agent. |
| **Identity** | The fully rendered system prompt including environment, tools, guidelines, rulefiles, and custom instructions. |
| **World** | Complete context snapshots showing the full conversation: user context, agent thoughts, tool calls with arguments, and observations (tool results). |
| **Logs** | Activity logs with timestamps showing agent events and status changes. |
| **Metrics** | Cost, status, and category information for the agent. |

The **Thoughts** tab provides a conversational interface where you can interact with the agent in real-time. The **World** tab shows the raw conversation history as sent to the LLM, making it ideal for debugging and understanding exactly what context the agent sees.

Note: Shell tools have their own Detail Bar with a Terminal interface when selected directly.

## State and Work Items

Each work item has its own independent agent state:

- **New work items** start with empty state
- **State accumulates** as the agent processes
- **Completion clears** the active state but preserves history
- **Multiple work items** can have different states simultaneously

This isolation ensures agents can handle multiple tasks without state confusion.

## Benefits of This Approach

| Benefit | Description |
|---------|-------------|
| **Transparency** | See exactly how the agent reasoned |
| **Debuggability** | Identify where and why things went wrong |
| **Interruptibility** | Pause and resume without losing context |
| **Steerability** | Inject guidance to correct course |
| **Auditability** | Review complete decision history |

The application-level chain of thought transforms opaque LLM calls into a transparent, controllable reasoning process.

