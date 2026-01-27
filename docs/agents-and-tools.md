# Agents and Tools

Ainulindale has two fundamental entity types: **Agents** and **Tools**. Understanding the distinction between them is essential to designing effective workflows on the hex board.

## Overview

| Aspect | Agents | Tools |
|--------|--------|-------|
| **Purpose** | Think, plan, and make decisions | Provide capabilities and resources |
| **Powered by** | LLM (Large Language Model) | Local system access |
| **Behavior** | Active - initiates actions | Passive - responds to requests |
| **Color** | Green | Cyan |

## Agents

Agents are LLM-powered entities that can think, reason, and take actions. They are the "workers" on your board that process tasks and make decisions.

### What Agents Do

- **Receive work items** from tasklists, filesystems, or events
- **Think** about what actions to take using their LLM
- **Use tools** that are adjacent to them on the board
- **Complete tasks** and emit events

### Agent Configuration

Each agent has configurable properties that affect its behavior:

| Property | Description |
|----------|-------------|
| **Model** | Which LLM to use (e.g., Claude 3.5 Sonnet, GPT-4) |
| **Provider** | LLM provider (Anthropic, OpenAI, DeepSeek, etc.) |
| **Template** | Pre-configured role (Planner, Coder, Reviewer) |
| **Custom Instructions** | Additional instructions appended to the system prompt |
| **Rulefiles** | Reusable rule sets that can be equipped to the agent |

The agent's system prompt is dynamically generated based on its configuration, available tools, and board position. See [System Prompt Generation](./system-prompt-generation.md) for details.

### Agent Templates

Built-in templates provide starting configurations for common roles:

| Template | Purpose | Temperature |
|----------|---------|-------------|
| **Planner** | Strategic planning and task decomposition | 0.7 (more creative) |
| **Coder** | Code generation and implementation | 0.2 (more precise) |
| **Reviewer** | Code review and quality assurance | 0.3 (balanced) |

### The Agent Loop

When an agent receives a work item, it enters a think-act-observe loop:

1. **Think** - The agent's LLM analyzes the current situation and decides what to do
2. **Act** - The agent executes tool calls or signals completion
3. **Observe** - The agent receives results from its actions
4. **Repeat** - The loop continues until the agent signals completion

This loop runs without a fixed iteration limit, allowing agents to complete complex multi-step tasks naturally. The agent maintains state across iterations, building up a chain of thought that provides context for each decision. See [Agent State and Chain of Thought](./agent-state.md) for details on how this state is constructed and managed.

## Tools

Tools are passive entities that provide capabilities to adjacent agents. They do not think or make decisions - they simply execute operations when requested.

### What Tools Do

- **Expose operations** to agents within range
- **Enforce RBAC** based on agent position and zone configuration
- **Execute requests** from authorized agents
- **Emit events** when state changes (e.g., new tasks available)

### Tool Types

There are three built-in tool types:

#### Filesystem Tool

Provides sandboxed file system access within a configured root path.

| Operation | Permission | Description |
|-----------|------------|-------------|
| `read_file` | Read | Read file contents |
| `write_file` | Write | Write content to a file |
| `list_directory` | Read | List files and folders |
| `search_files` | Read | Search for files by pattern |
| `create_directory` | Write | Create a new directory |
| `delete_file` | Write | Delete a file |
| `copy_file` | Write | Copy a file |
| `move_file` | Write | Move or rename a file |
| `codebase_search` | Execute | Semantic code search using RAG |

The `codebase_search` operation enables agents to search codebases using natural language queries. When the board starts, all filesystem hexes are automatically indexed using tree-sitter for syntax-aware code parsing and local embeddings for semantic search. See [Codebase Indexer and RAG System](./indexer.md) for details on how indexing works, supported languages, and search capabilities.

#### Shell Tool

Provides command execution capabilities.

| Operation | Permission | Description |
|-----------|------------|-------------|
| `run_command` | Execute | Execute a shell command |

The shell tool automatically inherits its working directory from an adjacent filesystem tool, if one exists with appropriate RBAC access.

#### Tasklist Tool

Provides task queue management for coordinating work between agents.

| Operation | Permission | Description |
|-----------|------------|-------------|
| `list_tasks` | Read | List all tasks in the queue |
| `get_task` | Read | Get details of a specific task |
| `add_task` | Write | Add a new task to the queue |

Tasklist tools use a **pull-based model**: agents claim tasks from the queue rather than having tasks pushed to them. This prevents duplicate work when multiple agents share a tasklist.

### Tool Configuration

Each tool type has specific configuration options:

| Tool Type | Configuration |
|-----------|---------------|
| **Filesystem** | Root path (working directory for file operations) |
| **Shell** | (Inherits working directory from adjacent filesystem) |
| **Tasklist** | Initial tasks, file path for persistence |

## How Agents Access Tools

Agents gain access to tools through **spatial proximity** on the hex board:

1. **Placement** - Place an agent adjacent to (or within range of) a tool
2. **Discovery** - The agent automatically discovers available tools
3. **RBAC Check** - Each operation is checked against the tool's zone configuration
4. **Execution** - Authorized operations are executed by the tool

The specific operations available depend on:
- Which direction the agent is positioned relative to the tool
- The tool's zone pattern configuration
- The tool's range setting

See the [RBAC System](./rbac-system.md) documentation for details on how permissions are determined.

## Designing Workflows

When designing a workflow on the hex board:

1. **Place tools first** - Position filesystem, shell, and tasklist tools where needed
2. **Configure tool RBAC** - Set zone patterns to control access
3. **Add agents** - Position agents adjacent to the tools they need
4. **Consider data flow** - Use tasklists to coordinate work between agents

### Example: Code Review Pipeline

```
[Tasklist] ← Planner reads tasks, writes subtasks
     ↓
[Planner] → [Tasklist] ← Coder reads subtasks
                ↓
           [Coder] → [Filesystem] ← Coder writes code
                          ↓
                     [Reviewer] ← Reviewer reads code
```

In this layout:
- The Planner reads from an input tasklist and writes to a work tasklist
- The Coder reads from the work tasklist and writes to the filesystem
- The Reviewer reads from the filesystem to review changes

