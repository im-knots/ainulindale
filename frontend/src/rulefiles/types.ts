/**
 * Rulefile Types - Shared rules that can be equipped to agent hexes
 * 
 * Rulefiles are reusable sets of guidelines, constraints, and behaviors
 * that can be attached to multiple agents. They extend the agent's system
 * prompt with additional context and rules.
 */

/**
 * A single rule within a rulefile
 */
export interface Rule {
  id: string;
  name: string;
  description: string;
  content: string;  // The actual rule text that gets added to prompts
  priority: number; // Higher priority rules are applied first
  enabled: boolean;
}

/**
 * A collection of rules that can be equipped to agents
 */
export interface Rulefile {
  id: string;
  name: string;
  description: string;
  version: string;
  category: RulefileCategory;
  tags: string[];
  rules: Rule[];
  /** Markdown content - the primary content format for rulefiles */
  content: string;
  createdAt: Date;
  updatedAt: Date;
  isBuiltin: boolean;  // Built-in rulefiles cannot be deleted
}

/**
 * Categories for organizing rulefiles
 */
export type RulefileCategory = 
  | 'coding'      // Code style, best practices, language-specific rules
  | 'security'    // Security guidelines, access control rules
  | 'quality'     // Code review, testing, documentation standards
  | 'process'     // Workflow, git conventions, PR guidelines
  | 'persona'     // Agent personality, communication style
  | 'domain'      // Domain-specific knowledge and constraints
  | 'custom';     // User-defined

/**
 * Reference to an equipped rulefile on an agent
 */
export interface EquippedRulefile {
  rulefileId: string;
  enabled: boolean;
  overrides?: Record<string, string>; // Rule ID -> overridden content
}

/**
 * Serialized rulefile for storage
 */
export interface SerializedRulefile {
  id: string;
  name: string;
  description: string;
  version: string;
  category: RulefileCategory;
  tags: string[];
  rules: Rule[];
  content: string;
  createdAt: string;  // ISO date string
  updatedAt: string;  // ISO date string
  isBuiltin: boolean;
}

/**
 * Category metadata for UI
 */
export const RULEFILE_CATEGORY_INFO: Record<RulefileCategory, { name: string; icon: string; description: string }> = {
  coding: {
    name: 'Coding Standards',
    icon: 'CS',
    description: 'Code style, best practices, and language-specific rules',
  },
  security: {
    name: 'Security',
    icon: 'SC',
    description: 'Security guidelines and access control rules',
  },
  quality: {
    name: 'Quality',
    icon: 'QA',
    description: 'Code review, testing, and documentation standards',
  },
  process: {
    name: 'Process',
    icon: 'PR',
    description: 'Workflow, git conventions, and PR guidelines',
  },
  persona: {
    name: 'Persona',
    icon: 'PS',
    description: 'Agent personality and communication style',
  },
  domain: {
    name: 'Domain',
    icon: 'DM',
    description: 'Domain-specific knowledge and constraints',
  },
  custom: {
    name: 'Custom',
    icon: 'CU',
    description: 'User-defined rulefiles',
  },
};

/**
 * Create a new empty rule
 */
export function createRule(name: string, content: string = ''): Rule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: '',
    content,
    priority: 0,
    enabled: true,
  };
}

/**
 * Create a new empty rulefile
 */
export function createRulefile(name: string, category: RulefileCategory = 'custom', content: string = ''): Rulefile {
  const now = new Date();
  return {
    id: `rulefile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: '',
    version: '1.0.0',
    category,
    tags: [],
    rules: [],
    content,
    createdAt: now,
    updatedAt: now,
    isBuiltin: false,
  };
}

/**
 * Serialize a rulefile for storage
 */
export function serializeRulefile(rulefile: Rulefile): SerializedRulefile {
  return {
    ...rulefile,
    createdAt: rulefile.createdAt.toISOString(),
    updatedAt: rulefile.updatedAt.toISOString(),
  };
}

/**
 * Deserialize a rulefile from storage
 */
export function deserializeRulefile(data: SerializedRulefile): Rulefile {
  return {
    ...data,
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  };
}

