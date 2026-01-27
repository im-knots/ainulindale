/**
 * Prompts Module - Dynamic system prompt generation for agents
 */

export { buildSystemPrompt } from './system-prompt-builder';
export type { SystemPromptConfig } from './system-prompt-builder';
export { getEnvironmentContext, formatEnvironment } from './environment';
export type { EnvironmentContext } from './environment';
export {
  BEHAVIORAL_GUIDELINES,
  TASK_COMPLETION,
  CODE_CONVENTIONS,
  PLANNER_GUIDELINES,
  CODER_GUIDELINES,
  REVIEWER_GUIDELINES,
  formatToolSummary,
  formatEnvironmentContext,
  buildToolWorkflowInstructions,
  buildToolsSection,
} from './base-prompts';
export type { ToolsSectionConfig } from './base-prompts';

