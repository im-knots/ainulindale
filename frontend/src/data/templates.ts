// Built-in entity templates - simplified to core types for local agent swarms

import { Template, TemplatesByCategory, CategoryInfo } from '../services/templateService';

// Category information - simplified to just agents and tools
const CATEGORIES: Record<string, CategoryInfo> = {
  agent: { category: 'agent', name: 'Agent', description: 'LLM-powered agents for reasoning and task execution', icon: 'A', color: '#22c55e' },
  tool: { category: 'tool', name: 'Tool', description: 'Local tools for filesystem, shell, and task management', icon: 'T', color: '#06b6d4' },
};

// Agent templates - core agents for coding workflows
// System prompts are generated dynamically by the prompt builder based on template type, RBAC, and tool access
const AGENT_TEMPLATES: Template[] = [
  { id: 'planner', category: 'agent', name: 'Planner', description: 'Strategic planning and task decomposition agent', icon: 'P', cost: 30, isBuiltin: true, config: { model: 'claude-3-5-sonnet', temperature: 0.7 } },
  { id: 'coder', category: 'agent', name: 'Coder', description: 'Code generation and implementation agent', icon: 'C', cost: 40, isBuiltin: true, config: { model: 'claude-3-5-sonnet', temperature: 0.2 } },
  { id: 'reviewer', category: 'agent', name: 'Reviewer', description: 'Code review and quality assurance agent', icon: 'R', cost: 25, isBuiltin: true, config: { model: 'claude-3-5-sonnet', temperature: 0.3 } },
];

// Tool templates - local tools for coding workflows
const TOOL_TEMPLATES: Template[] = [
  { id: 'filesystem', category: 'tool', name: 'Filesystem', description: 'Read and write files in a workspace directory', icon: 'FS', cost: 0, isBuiltin: true, config: { toolType: 'filesystem', rootPath: '' } },
  { id: 'shell', category: 'tool', name: 'Shell', description: 'Execute shell commands', icon: 'SH', cost: 0, isBuiltin: true, config: { toolType: 'shell', shell: 'bash', allowedCommands: [] } },
  { id: 'tasklist', category: 'tool', name: 'Task Queue', description: 'In-memory task queue for work distribution', icon: 'TQ', cost: 0, isBuiltin: true, config: { toolType: 'tasklist', tasks: [] } },
];

// All templates by category
const TEMPLATES_BY_CATEGORY: Record<string, Template[]> = {
  agent: AGENT_TEMPLATES,
  tool: TOOL_TEMPLATES,
};

// Export function to get all templates grouped by category
export function getAllTemplates(): TemplatesByCategory[] {
  return Object.entries(CATEGORIES).map(([key, category]) => ({
    category,
    templates: TEMPLATES_BY_CATEGORY[key] || [],
  }));
}

// Export function to get templates for a specific category
export function getTemplatesByCategory(category: string): Template[] {
  return TEMPLATES_BY_CATEGORY[category] || [];
}

// Export function to get a specific template
export function getTemplate(category: string, id: string): Template | null {
  const templates = TEMPLATES_BY_CATEGORY[category];
  if (!templates) return null;
  return templates.find(t => t.id === id) || null;
}

// Export category info
export function getCategoryInfo(category: string): CategoryInfo | null {
  return CATEGORIES[category] || null;
}

export { CATEGORIES, TEMPLATES_BY_CATEGORY };

