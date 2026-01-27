/**
 * System Prompt Builder - Dynamically composes agent system prompts
 *
 * Builds prompts based on:
 * - Entity type (planner, coder, reviewer)
 * - Available tools (determined by RBAC on the board)
 * - Environment context (working directory, platform)
 * - Equipped rulefiles
 *
 * Agents are tool-aware but not RBAC-aware. They use whatever tools they have
 * available. RBAC determines which tools get injected, but agents don't need
 * to understand the permission model.
 */

import { AgentEntity, AppState } from '../../state/store';
import { AgentToolDefinition } from '../tools/agent-tools';
import { rulefileLibrary } from '../../rulefiles';
import { getEnvironmentContext, formatEnvironment } from './environment';
import {
  BEHAVIORAL_GUIDELINES,
  TASK_COMPLETION,
  PLANNER_GUIDELINES,
  CODER_GUIDELINES,
  REVIEWER_GUIDELINES,
  buildToolsSection,
} from './base-prompts';

export interface SystemPromptConfig {
  agentEntity: AgentEntity;
  availableTools: AgentToolDefinition[];
  state: AppState;
  /** Detailed tool information with parameter descriptions from Zod schemas */
  detailedToolInfo?: string;
}

/**
 * Build the complete system prompt for an agent
 *
 * Section order:
 * 1. Environment (date, platform, workspace)
 * 2. Tools (available tools, usage guidelines)
 * 3. Behavioral guidelines
 * 4. Role-specific guidelines (includes role identity)
 * 5. Task completion
 * 6. Rulefiles
 * 7. Custom instructions
 */
export function buildSystemPrompt(config: SystemPromptConfig): string {
  const { agentEntity, availableTools, state, detailedToolInfo } = config;
  const sections: string[] = [];
  const envContext = getEnvironmentContext(agentEntity.id, state);

  // 1. Environment context (date, platform, workspace) - at top to ground the agent
  const envSection = formatEnvironment(envContext);
  sections.push(envSection);

  // 2. Tools section - right after environment so agent knows its capabilities early
  const toolNames = availableTools.map(t => t.name);
  const toolsSection = buildToolsSection({
    toolNames,
    detailedToolInfo,
    shellType: envContext.shellType,
  });
  if (toolsSection) {
    sections.push(toolsSection);
  }

  // 3. Behavioral guidelines
  sections.push(BEHAVIORAL_GUIDELINES);

  // 4. Role-specific guidelines (includes role identity at the top)
  const roleGuidelines = getRoleGuidelines(agentEntity.template);
  if (roleGuidelines) {
    sections.push(roleGuidelines);
  }

  // 5. Task completion guidelines
  sections.push(TASK_COMPLETION);

  // 6. Equipped rulefiles
  const equipped = agentEntity.equippedRulefiles || [];
  if (equipped.length > 0) {
    const compiledRules = rulefileLibrary.compileRulesForAgent(equipped);
    if (compiledRules) {
      sections.push(compiledRules);
    }
  }

  // 7. Custom user instructions (appended at the end)
  if (agentEntity.systemPrompt && agentEntity.systemPrompt.trim()) {
    sections.push(`## Custom Instructions\n\n${agentEntity.systemPrompt.trim()}`);
  }

  return sections.join('\n\n');
}

/**
 * Get role-specific guidelines based on template.
 * Role identity is now included at the top of each role's guidelines in base-prompts.ts.
 */
function getRoleGuidelines(template: string): string | null {
  const guidelines: Record<string, string> = {
    planner: PLANNER_GUIDELINES,
    coder: CODER_GUIDELINES,
    reviewer: REVIEWER_GUIDELINES,
  };

  return guidelines[template] || null;
}
