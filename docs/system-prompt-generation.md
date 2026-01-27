# System Prompt Generation

Ainulindale generates **dynamic system prompts** for each agent based on its configuration, position on the board, and available tools. This ensures agents receive context-aware instructions tailored to their current capabilities.

## Why Dynamic Prompts?

Static system prompts cannot adapt to:
- **Changing tool access** - An agent's available tools depend on adjacent hexes and RBAC
- **Environment context** - Working directory, platform, and shell type vary per board
- **Role requirements** - Different agent templates need different guidelines
- **User customization** - Rulefiles and custom instructions extend behavior

Dynamic generation solves these problems by composing prompts at runtime from multiple sources.

## Prompt Structure

Each agent's system prompt is composed of seven sections, in order:

| Section | Purpose |
|---------|---------|
| **1. Environment** | Grounds the agent with identity, date, platform, and workspace |
| **2. Tools** | Lists available tools with usage guidelines |
| **3. Behavioral Guidelines** | Core execution patterns for all agents |
| **4. Role Guidelines** | Template-specific instructions (Planner, Coder, Reviewer) |
| **5. Task Completion** | How to signal work is complete |
| **6. Rulefiles** | Equipped rule sets that extend behavior |
| **7. Custom Instructions** | User-provided additions |

## Environment Context

The environment section appears first to ground the agent:

| Field | Source |
|-------|--------|
| **Agent ID** | Unique identifier for task claiming |
| **Agent Name** | Display name from entity configuration |
| **Today** | Current date (YYYY-MM-DD format) |
| **Platform** | Operating system (macOS, Windows, Linux) |
| **Workspace** | Primary working directory from adjacent filesystem tools |
| **Shell** | Shell type from adjacent shell tools (bash, zsh, powershell) |

The workspace and shell are determined by examining adjacent tool hexes with appropriate RBAC permissions. The first filesystem tool with write permission becomes the primary workspace.

## Tools Section

The tools section is generated based on:
- **Adjacent tool hexes** within range
- **RBAC permissions** for each tool operation
- **Detailed parameter info** extracted from tool definitions

Each available tool includes:
- Tool name and description
- Required parameters with types
- Usage guidelines specific to that tool category

The agent only sees tools it has permission to use. This keeps the prompt focused and prevents attempts to call unauthorized operations.

## Role-Specific Guidelines

Based on the agent's template, role-specific guidelines are included:

| Template | Focus |
|----------|-------|
| **Planner** | Task decomposition, breaking down problems, creating actionable subtasks |
| **Coder** | Code generation, implementation patterns, file editing, testing |
| **Reviewer** | Code review, quality analysis, identifying issues, suggesting improvements |

Each role includes:
- Role identity statement
- Recommended workflow patterns
- Output format expectations
- Tool usage priorities

## Rulefiles

Rulefiles are reusable rule sets that can be equipped to agents. They extend the system prompt with additional guidelines, constraints, or behaviors.

### Rulefile Categories

| Category | Purpose |
|----------|---------|
| **Coding** | Code style, best practices, language-specific rules |
| **Security** | Security guidelines, access control rules |
| **Quality** | Code review standards, testing requirements |
| **Process** | Workflow conventions, git guidelines, PR standards |
| **Persona** | Communication style, response format |
| **Domain** | Domain-specific knowledge and constraints |
| **Custom** | User-defined rules |

### Built-in Rulefiles

Ainulindale includes several built-in rulefiles:

| Rulefile | Category | Description |
|----------|----------|-------------|
| **TypeScript Standards** | Coding | TypeScript best practices and strict mode |
| **Code Review Checklist** | Quality | Systematic code review guidelines |
| **Git Workflow** | Process | Branch naming, commit messages, PR conventions |
| **Security Guidelines** | Security | Security considerations and practices |
| **Concise Communicator** | Persona | Brief, focused communication style |
| **Test-Driven Development** | Quality | TDD workflow and testing patterns |

### Equipping Rulefiles

To equip a rulefile to an agent:
1. Select the agent hex on the board
2. Open the Rulefiles panel
3. Browse or search the rulefile library
4. Check the rulefile to equip it
5. Apply changes

Multiple rulefiles can be equipped to a single agent. They are applied in order, with all enabled rules combined into the final prompt.

### Custom Rulefiles

You can create custom rulefiles to encode:
- Organization-specific coding standards
- Project conventions
- Domain expertise
- Compliance requirements

Custom rulefiles use Markdown format for their content, making them easy to write and maintain.

## Custom Instructions

The final section of the system prompt includes any custom instructions configured on the agent. These are user-provided text that extends or overrides the default behavior.

Custom instructions are applied last, giving them the highest priority in the prompt. Use them for:
- Task-specific guidance
- Project context
- Override default behaviors
- Add unique constraints

## How It All Fits Together

When an agent starts processing:

1. **Discover tools** - Find adjacent tool hexes and filter by RBAC
2. **Extract environment** - Determine workspace, platform, shell from accessible tools
3. **Load rulefiles** - Compile equipped rulefiles into prompt text
4. **Build prompt** - Combine all seven sections in order
5. **Send to LLM** - The complete prompt becomes the agent's system message

This dynamic composition ensures each agent receives precisely the context it needs based on its current board position and configuration.

