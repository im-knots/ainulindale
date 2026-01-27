# RBAC System

The **Role-Based Access Control (RBAC)** system is the primary driver of the hex board game mechanics. It determines which agents can access which tools, and what operations they can perform, based on their spatial position on the board.

## Core Concept

In Ainulindale, **position implies permission**. When you place an agent next to a tool hex, the agent gains access to that tool - but the *type* of access depends on which direction the agent is positioned relative to the tool.

This creates a visual programming language where the spatial layout of your board directly encodes your security and workflow policies.

## Permission Types

There are three permission types that control what operations an agent can perform:

| Permission | Description | Example Operations |
|------------|-------------|-------------------|
| **Read** | View and retrieve data | List files, read file contents, list tasks, search code |
| **Write** | Create, modify, or delete data | Write files, create directories, add tasks, delete files |
| **Execute** | Run compute-intensive operations | Execute shell commands, run codebase search |

## Directional Zones

Each tool hex divides the surrounding space into six directional zones, corresponding to the six hex directions:

```
       NW    NE
         \  /
     W ---●--- E
         /  \
       SW    SE
```

Each direction can be configured to grant different permissions. This allows you to create sophisticated access patterns by positioning agents in specific zones around a tool.

## Zone Patterns

Zone patterns are pre-configured permission layouts that define which directions grant which permissions.

### Uniform Access Patterns

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Full Access** | All directions grant read, write, and execute | Simple setups where all agents need full access |
| **Read Only** | All directions grant only read access | Shared reference data that shouldn't be modified |
| **Write Only** | All directions grant only write access | Output destinations where agents deposit results |

### Horizontal Split Patterns (Left/Right)

These patterns divide the hex into West (W, NW, SW) and East (E, NE, SE) zones:

| Pattern | West Side | East Side | Use Case |
|---------|-----------|-----------|----------|
| **Left Read / Right Write** | Read | Write | Pipeline: input on left, output on right |
| **Left Write / Right Read** | Write | Read | Reverse pipeline direction |
| **Left R/W / Right Read** | Read + Write | Read | Privileged agents on left, observers on right |
| **Left R/W / Right Write** | Read + Write | Write | Privileged agents on left, writers on right |
| **Left Read / Right R/W** | Read | Read + Write | Observers on left, privileged agents on right |
| **Left Write / Right R/W** | Write | Read + Write | Writers on left, privileged agents on right |

### Vertical Split Patterns (Top/Bottom)

These patterns divide the hex into Top (NE, NW) and Bottom (SE, SW) zones:

| Pattern | Top Side | Bottom Side | Use Case |
|---------|----------|-------------|----------|
| **Top Read / Bottom Write** | Read | Write | Vertical pipeline: input from top, output to bottom |
| **Top Write / Bottom Read** | Write | Read | Reverse vertical pipeline |
| **Top R/W / Bottom Read** | Read + Write | Read | Privileged agents on top, observers on bottom |
| **Top R/W / Bottom Write** | Read + Write | Write | Privileged agents on top, writers on bottom |
| **Top Read / Bottom R/W** | Read | Read + Write | Observers on top, privileged agents on bottom |
| **Top Write / Bottom R/W** | Write | Read + Write | Writers on top, privileged agents on bottom |

### Complex Patterns

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Top R/W, Sides Split** | Top (NW, NE) has R/W, left (W, SW) reads, right (E, SE) writes | Three-zone workflows with privileged top position |

## How Access Is Determined

When an agent attempts to use a tool, the system checks:

1. **Is the agent within range?** - Tools have a configurable range (default: 1 hex). Agents must be within this range to have any access.

2. **Which direction is the agent?** - The system calculates which of the six directions the agent is positioned relative to the tool.

3. **What permissions does that zone grant?** - Based on the tool's zone configuration, the agent receives the permissions assigned to that direction.

4. **Does the operation require that permission?** - Each tool operation has a required permission level. The operation only proceeds if the agent has the necessary permission.

## Tool Permission Requirements

Different tool operations require different permission levels:

### Filesystem Tool
- **Read permission**: `read_file`, `list_directory`, `search_files`, `file_exists`, `get_file_info`
- **Write permission**: `write_file`, `create_directory`, `delete_file`, `delete_directory`, `copy_file`, `move_file`
- **Execute permission**: `codebase_search`

### Tasklist Tool
- **Read permission**: `list_tasks`, `get_task`
- **Write permission**: `add_task`

### Shell Tool
- **Execute permission**: `run_command`

## Range-Based vs Explicit Linking

Tools support two linking modes:

### Range-Based (Default)
Agents within the configured range automatically have access based on their directional zone. This is the spatial, game-like mode where position determines access.

### Explicit Linking
Specific hexes are manually linked to the tool, bypassing range calculations. This is useful for connecting distant hexes or creating non-spatial access patterns.


## Practical Examples

### Pipeline Workflow
Place a filesystem tool with "Read Left / Write Right" pattern:
- Input agents on the west side can read source files
- Processing agents in the middle have no direct access (must receive data via events)
- Output agents on the east side can write results

### Shared Code Repository
Place a filesystem tool with "Read-Only" pattern:
- All surrounding agents can read and search the codebase
- No agent can modify the source files
- Protects against accidental changes

### Privileged Operator
Place a shell tool with "R/W Left / Read Right" pattern:
- Trusted operator agent on the west has full shell access
- Observer agents on the east can only view command history
- Separates execution authority from monitoring

## Visual Feedback

The hex board provides visual feedback for RBAC zones:
- Zone boundaries are displayed when a tool is selected
- Different colors indicate read, write, and read/write zones
- Agents show their current permission level relative to nearby tools

This makes it easy to understand and debug access patterns by simply looking at the board layout.

