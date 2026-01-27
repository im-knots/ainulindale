# Board Execution and Event System

This document explains how Ainulindale executes a board, how hexes communicate via events, and how RBAC determines which events each agent can consume.

For RBAC concepts (zones, permissions, patterns), see the [RBAC System](./rbac-system.md) documentation.

## Starting the Board

When you click **Start**, the board goes through a startup sequence:

1. **Context managers initialize** - File change tracking and reservation systems clear stale state
2. **Actors are created** - Each hex with an entity gets an actor (AgentActor for agents, ToolActor for tools)
3. **Actors start** - All actors begin their processing loops and set up event subscriptions
4. **Indexer starts** - The codebase indexer begins indexing filesystem hexes for RAG-based search
5. **Store subscription** - The board listens for entity changes to hot-reload configurations

The board emits lifecycle events: `board.starting`, `board.started`, `board.stopping`, `board.stopped`.

## The Event Bus

Hexes communicate through a central **EventBus** - an in-browser publish/subscribe system. This enables:

- **Decoupled communication** - Hexes don't need direct references to each other
- **Real-time updates** - UI components receive events instantly
- **Flexible subscription** - Subscribe to specific event types, all events, or events from a specific hex

### Event Structure

Every event contains:

| Field | Description |
|-------|-------------|
| **type** | The event category (e.g., `tasks.available`, `filesystem.changed`) |
| **hexId** | The entity ID of the hex that emitted the event |
| **boardId** | The board this event belongs to |
| **data** | Event-specific payload (varies by type) |
| **timestamp** | When the event occurred |

## Event Types

### Board Lifecycle Events

| Event | When It Occurs |
|-------|----------------|
| `board.starting` | Board is beginning startup sequence |
| `board.started` | All actors are running, board is active |
| `board.stopping` | Board is beginning shutdown sequence |
| `board.stopped` | All actors have stopped |
| `board.error` | An error occurred during startup or execution |

### Task Queue Events (Pull-Based Model)

| Event | Emitted By | Data |
|-------|------------|------|
| `tasks.available` | Tasklist tool | Number of available tasks, tool hex key |
| `task.claimed` | Tasklist tool | Task ID, claimer identity |
| `task.completed` | Tasklist tool | Task ID, completion status |
| `task.released` | Tasklist tool | Task ID (returned to queue) |

### Work Flow Events

| Event | Purpose |
|-------|---------|
| `work.received` | A hex received a work item |
| `work.completed` | A hex finished processing work |
| `work.flowing` | Work is moving between hexes (for visualization) |

### Filesystem Events

| Event | When It Occurs |
|-------|----------------|
| `filesystem.changed` | An agent modified files (create, write, delete, move) |

### User Interaction Events

| Event | Purpose |
|-------|---------|
| `user.message` | User injected guidance to an agent |

### Shell Events

| Event | Purpose |
|-------|---------|
| `shell.command.start` | Shell command began execution |
| `shell.command.output` | Shell command produced output |
| `shell.command.exit` | Shell command finished |

## RBAC-Filtered Event Consumption

This is the core principle: **Agents subscribe to event types, but check RBAC before reacting.**

When an agent starts, it sets up subscriptions to relevant event types. However, receiving an event doesn't mean acting on it - the agent first checks if it has the required RBAC permissions.

### Task Queue Example

1. **Tasklist tool** emits `tasks.available` with its hex key
2. **All agents** subscribed to `tasks.available` receive the event
3. **Each agent checks** if it has READ permission to that tasklist (via RBAC zone check)
4. **Only permitted agents** attempt to claim a task

This means an agent next to a tasklist's WRITE zone receives the event but won't try to claim tasks - it lacks READ permission.

### Filesystem Change Example

1. **Agent A** writes a file to a filesystem tool
2. **Agent A** emits `filesystem.changed` with the filesystem entity ID
3. **All agents** subscribed to `filesystem.changed` receive the event
4. **Agent A skips** the event (it was the one who made the change)
5. **Other agents check** if they have READ permission to that filesystem
6. **Permitted agents** may react (e.g., a reviewer agent starts reviewing the changes)

This enables reactive workflows where code written by one agent automatically triggers review by another agent - all controlled by RBAC zones.

## How Agents Subscribe to Events

When an agent actor starts, it subscribes to several event types:

| Event Type | RBAC Check | Purpose |
|------------|------------|---------|
| `tasks.available` | READ permission on source tasklist | Pull new tasks to work on |
| `filesystem.changed` | READ permission on source filesystem | React to file changes by other agents |
| `user.message` | Event must be for this agent's hex | Receive user guidance |
| `entity.updated` | Tool must be in range | Invalidate tool cache when adjacent tools change |

Each subscription includes an RBAC filter that runs before the agent takes action.

## How Tools Emit Events

Tools emit events when state changes occur:

| Tool Type | Events Emitted | When |
|-----------|----------------|------|
| **Tasklist** | `tasks.available` | Tasks added or released back to queue |
| **Tasklist** | `task.claimed` | An agent claimed a task |
| **Tasklist** | `task.completed` | An agent completed a task |
| **Tasklist** | `task.released` | A task was returned to queue (timeout, agent stopped) |

Filesystem and shell tools don't emit events directly - agents emit events after using these tools to inform other agents of changes.

## Stopping the Board

When you click **Stop**, the board gracefully shuts down:

1. **Indexer stops** - Codebase indexing halts
2. **Store unsubscribes** - No more hot-reload updates
3. **Actors stop** - Each actor cleans up subscriptions and aborts in-progress work
4. **Context managers clear** - File reservations and change tracking reset

In-progress LLM calls are aborted, and claimed tasks are released back to their queues.

## Benefits of This Architecture

| Benefit | Description |
|---------|-------------|
| **Spatial Security** | RBAC zones visually encode who can react to what |
| **Reactive Workflows** | Agents automatically respond to changes by permitted neighbors |
| **Loose Coupling** | Hexes communicate without knowing each other's implementation |
| **Visibility** | All events flow through a central bus, enabling logging and debugging |
| **Graceful Degradation** | Agents that lack permission simply ignore events |

The event system combined with RBAC creates workflows where the spatial layout of the board is the security policy - position on the grid determines what events an agent can meaningfully consume.

