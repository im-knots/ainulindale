# Getting Started

Ainulindale is a **board game for AI orchestration**. You design workflows by placing agents and tools on a hex grid, where spatial position determines access and data flow.

## The Board

The hex grid is your workspace. Each hex is a slot where you can place an entity:

- **Agents** (green) - LLM-powered workers that think and use tools
- **Tools** (cyan) - Resources like filesystems, shells, and task queues

Click any empty hex to see the placement menu, then choose what to place.

## Position = Permission

The core mechanic: **where you place things determines what they can do**.

When an agent is adjacent to a tool, it can access that tool. But the *direction* matters - each tool divides its surroundings into **zones** with different permissions:

```
       NW    NE
         \  /
     W ---●--- E
         /  \
       SW    SE
```

For example, with a "Left Read / Right Write" pattern:
- Agents on the **west side** (W, NW, SW) can read files
- Agents on the **east side** (E, NE, SE) can write files

This creates visual pipelines - data flows based on where things are positioned.

## Tool Types

| Tool | What It Provides | Key Permissions |
|------|------------------|-----------------|
| **Filesystem** | File access within a root path | Read: list/read files. Write: create/modify/delete. Execute: codebase search |
| **Shell** | Command execution | Execute: run shell commands |
| **Tasklist** | Task queue for coordination | Read: claim tasks. Write: add tasks |

Configure each tool by selecting it and using the side panel.

## Agent Templates

Agents have built-in templates that shape their behavior:

| Template | Purpose | Best For |
|----------|---------|----------|
| **Planner** | Breaks down tasks, creates plans | Starting points, coordination |
| **Coder** | Writes and modifies code | Implementation work |
| **Reviewer** | Reviews code, suggests improvements | Quality assurance |

Select a template when configuring an agent, or create custom instructions.

## Starting the Board

Click **Start** to begin execution:

1. All agents wake up and start their processing loops
2. Filesystem hexes are indexed for semantic code search
3. Agents react to events from tools they have access to

The board runs continuously until you click **Stop**.

## The Detail Bar

When you select a hex, the **Detail Bar** appears at the bottom:

**For Agents:**
| Tab | Shows |
|-----|-------|
| Thoughts | Conversation view - see what the agent is thinking, send prompts |
| Identity | The agent's system prompt with tools and guidelines |
| World | Raw conversation history sent to the LLM |
| Logs | Activity log with timestamps |
| Metrics | Cost and status information |

**Sending Prompts to Agents:**
The Thoughts tab input field lets you interact with agents directly:
- **Idle agent**: Your message becomes a new task and the agent starts working on it
- **Busy agent**: Your message is injected as guidance to help with the current task

**For Tools:**
| Tab | Shows |
|-----|-------|
| Terminal | Live shell output (shell tools only) |
| Tasks | Task queue contents (tasklist tools only) |

## Your First Workflow

Here's a simple setup to try:

```
     ┌─────────────┐
     │  Tasklist   │  ← You add tasks here
     │  (read-only)│
     └──────┬──────┘
            │ (agent claims tasks)
     ┌──────▼──────┐
     │   Coder     │  ← Processes tasks, writes files
     │   Agent     │
     └──────┬──────┘
            │ (agent writes output)
     ┌──────▼──────┐
     │  Filesystem │  ← Configured to your project
     └─────────────┘
```

1. **Place a Tasklist** - Set zone pattern to "Read Only"
2. **Place a Coder agent** - Position it adjacent to the tasklist
3. **Place a Filesystem** - Configure the root path to your project. Position the coder in the R/W zone
4. **Configure the agent** - Choose an LLM provider and model
5. **Start the board** - Add a task to the tasklist and watch the agent work

## Event-Driven Coordination

Agents don't need explicit routing - they react to events:

- **Tasklist adds a task** → Emits `tasks.available` → Agents in READ zone wake up and claim it
- **Agent writes a file** → Emits `filesystem.changed` → Agents in READ zone can react to the change
- **Shell command runs** → Emits output events → Connected agents see the results

Position determines subscription. An agent only receives events from tools it has RBAC access to.

## Budget & Tokens

The top bar tracks token usage for your board:

| Metric | Meaning |
|--------|---------|
| **Total Tokens** | Lifetime tokens consumed (input + output) |

This is a **persistent total** - it accumulates across board runs and never resets when you restart.

### Setting Token Limits

Click the **Total Tokens** display to open the budget popdown:

1. Enter a token limit (e.g., `100000` for 100K tokens, `1m` for 1 million)
2. Click **Save**

Set the limit to **0** for unlimited token usage.

### What Happens When Limits Are Hit

When token usage exceeds the limit:
- The board **stops automatically**
- A notification explains that the token limit was exceeded
- You can increase the limit and restart

### Visual Indicators

The progress bar under the token display shows utilization:

| Color | Meaning |
|-------|---------|
| Grey | No limit set (unlimited) |
| Blue | Under 80% of limit |
| Yellow | 80-99% of limit |
| Red | Limit exceeded |

### Per-Run vs Lifetime

Ainulindale tracks usage at two levels:

- **Lifetime totals** (top bar) - Never reset, used for budget limits
- **Per-run metrics** (hex heights) - Reset on board start, show current run activity

Hex heights grow during a run based on token usage, giving you a visual "heat map" of agent activity. When you restart the board, heights reset but your lifetime totals remain.

## Tips

- **Start simple** - Begin with one agent and one tool, then expand
- **Use the World tab** - Debug issues by seeing exactly what context the LLM receives
- **Position matters** - Rearrange hexes to change data flow without reconfiguring
- **Read zones for observers** - Put monitoring agents in read-only zones to watch without interfering
- **Multiple filesystems** - Point different filesystem hexes at different directories for isolation

## Next Steps

Explore the detailed documentation:

- [Agents and Tools](./agents-and-tools.md) - Deep dive into entity types
- [RBAC System](./rbac-system.md) - All 17 zone patterns explained
- [System Prompt Generation](./system-prompt-generation.md) - How agent prompts are built
- [Agent State](./agent-state.md) - Chain of thought and context construction
- [Board Execution](./board-execution.md) - Event system and actor lifecycle
- [Codebase Indexer](./indexer.md) - RAG-powered semantic code search

