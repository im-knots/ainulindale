/**
 * Rulefile Library - Service for managing rulefiles
 * 
 * Provides CRUD operations for rulefiles and includes built-in rulefiles
 * for common use cases.
 */

import { invoke } from '@tauri-apps/api/core';
import { 
  Rulefile, 
  Rule,
  RulefileCategory, 
  EquippedRulefile,
  SerializedRulefile,
  createRulefile,
  createRule,
  serializeRulefile,
  deserializeRulefile
} from './types';
import { BUILTIN_RULEFILES } from './builtins';

const STORAGE_KEY = 'ainu-rulefiles';

/**
 * Rulefile Library - Manages all rulefiles (builtin + custom)
 */
export class RulefileLibrary {
  private rulefiles: Map<string, Rulefile> = new Map();
  private initialized = false;

  /**
   * Initialize the library by loading built-in and custom rulefiles
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load built-in rulefiles
    for (const rulefile of BUILTIN_RULEFILES) {
      this.rulefiles.set(rulefile.id, rulefile);
    }

    // Load custom rulefiles from storage
    await this.loadFromStorage();

    this.initialized = true;
    console.log(`[RulefileLibrary] Initialized with ${this.rulefiles.size} rulefiles`);
  }

  /**
   * Get all rulefiles
   */
  getAll(): Rulefile[] {
    return Array.from(this.rulefiles.values());
  }

  /**
   * Get rulefiles by category
   */
  getByCategory(category: RulefileCategory): Rulefile[] {
    return this.getAll().filter(rf => rf.category === category);
  }

  /**
   * Get a rulefile by ID
   */
  get(id: string): Rulefile | undefined {
    return this.rulefiles.get(id);
  }

  /**
   * Create a new custom rulefile
   */
  async create(name: string, category: RulefileCategory = 'custom', content: string = ''): Promise<Rulefile> {
    const rulefile = createRulefile(name, category, content);
    this.rulefiles.set(rulefile.id, rulefile);
    await this.saveToStorage();
    return rulefile;
  }

  /**
   * Update a rulefile
   */
  async update(id: string, updates: Partial<Omit<Rulefile, 'id' | 'isBuiltin' | 'createdAt'>>): Promise<Rulefile | null> {
    const rulefile = this.rulefiles.get(id);
    if (!rulefile) return null;

    // Cannot modify built-in rulefiles
    if (rulefile.isBuiltin) {
      console.warn(`[RulefileLibrary] Cannot modify built-in rulefile: ${id}`);
      return rulefile;
    }

    const updated: Rulefile = {
      ...rulefile,
      ...updates,
      updatedAt: new Date(),
    };

    this.rulefiles.set(id, updated);
    await this.saveToStorage();
    return updated;
  }

  /**
   * Add a rule to a rulefile
   */
  async addRule(rulefileId: string, name: string, content: string): Promise<Rule | null> {
    const rulefile = this.rulefiles.get(rulefileId);
    if (!rulefile || rulefile.isBuiltin) return null;

    const rule = createRule(name, content);
    rulefile.rules.push(rule);
    rulefile.updatedAt = new Date();
    
    await this.saveToStorage();
    return rule;
  }

  /**
   * Update a rule within a rulefile
   */
  async updateRule(rulefileId: string, ruleId: string, updates: Partial<Omit<Rule, 'id'>>): Promise<Rule | null> {
    const rulefile = this.rulefiles.get(rulefileId);
    if (!rulefile || rulefile.isBuiltin) return null;

    const ruleIndex = rulefile.rules.findIndex(r => r.id === ruleId);
    if (ruleIndex === -1) return null;

    rulefile.rules[ruleIndex] = { ...rulefile.rules[ruleIndex], ...updates };
    rulefile.updatedAt = new Date();
    
    await this.saveToStorage();
    return rulefile.rules[ruleIndex];
  }

  /**
   * Remove a rule from a rulefile
   */
  async removeRule(rulefileId: string, ruleId: string): Promise<boolean> {
    const rulefile = this.rulefiles.get(rulefileId);
    if (!rulefile || rulefile.isBuiltin) return false;

    const initialLength = rulefile.rules.length;
    rulefile.rules = rulefile.rules.filter(r => r.id !== ruleId);
    
    if (rulefile.rules.length !== initialLength) {
      rulefile.updatedAt = new Date();
      await this.saveToStorage();
      return true;
    }
    return false;
  }

  /**
   * Delete a custom rulefile
   */
  async delete(id: string): Promise<boolean> {
    const rulefile = this.rulefiles.get(id);
    if (!rulefile || rulefile.isBuiltin) return false;

    this.rulefiles.delete(id);
    await this.saveToStorage();
    return true;
  }

  /**
   * Compile equipped rulefiles into a prompt extension
   * This generates the text to append to an agent's system prompt
   * Uses the markdown content field as the primary content source
   */
  compileRulesForAgent(equipped: EquippedRulefile[]): string {
    const sections: string[] = [];

    for (const eq of equipped) {
      if (!eq.enabled) continue;

      const rulefile = this.rulefiles.get(eq.rulefileId);
      if (!rulefile) continue;

      // Use the content field (markdown) as the primary source
      if (rulefile.content && rulefile.content.trim()) {
        sections.push(rulefile.content);
      } else if (rulefile.rules.length > 0) {
        // Fallback to discrete rules for backward compatibility
        const enabledRules = rulefile.rules
          .filter(r => r.enabled)
          .sort((a, b) => b.priority - a.priority);

        if (enabledRules.length === 0) continue;

        const ruleTexts = enabledRules.map(rule => {
          const content = eq.overrides?.[rule.id] ?? rule.content;
          return `## ${rule.name}\n${content}`;
        });

        sections.push(`# ${rulefile.name}\n\n${ruleTexts.join('\n\n')}`);
      }
    }

    if (sections.length === 0) return '';

    return `\n\n---\n# Equipped Rulefiles\n\n${sections.join('\n\n---\n\n')}`;
  }

  /**
   * Search rulefiles by name, description, or tags
   */
  search(query: string): Rulefile[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(rf =>
      rf.name.toLowerCase().includes(lowerQuery) ||
      rf.description.toLowerCase().includes(lowerQuery) ||
      rf.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Duplicate a rulefile (creates a custom copy)
   */
  async duplicate(id: string, newName?: string): Promise<Rulefile | null> {
    const original = this.rulefiles.get(id);
    if (!original) return null;

    const now = new Date();
    const duplicate: Rulefile = {
      ...original,
      id: `rulefile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newName ?? `${original.name} (Copy)`,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now,
      rules: original.rules.map(rule => ({
        ...rule,
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })),
    };

    this.rulefiles.set(duplicate.id, duplicate);
    await this.saveToStorage();
    return duplicate;
  }

  /**
   * Load custom rulefiles from storage
   */
  private async loadFromStorage(): Promise<void> {
    try {
      // Try Tauri storage first
      if (typeof invoke === 'function') {
        const data = await invoke<string | null>('get_setting', { key: STORAGE_KEY });
        if (data) {
          const serialized: SerializedRulefile[] = JSON.parse(data);
          for (const s of serialized) {
            const rulefile = deserializeRulefile(s);
            this.rulefiles.set(rulefile.id, rulefile);
          }
          return;
        }
      }
    } catch {
      // Fall back to localStorage
    }

    // localStorage fallback
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const serialized: SerializedRulefile[] = JSON.parse(data);
        for (const s of serialized) {
          const rulefile = deserializeRulefile(s);
          this.rulefiles.set(rulefile.id, rulefile);
        }
      }
    } catch (e) {
      console.error('[RulefileLibrary] Failed to load from storage:', e);
    }
  }

  /**
   * Save custom rulefiles to storage
   */
  private async saveToStorage(): Promise<void> {
    const customRulefiles = this.getAll()
      .filter(rf => !rf.isBuiltin)
      .map(serializeRulefile);

    const data = JSON.stringify(customRulefiles);

    try {
      // Try Tauri storage first
      if (typeof invoke === 'function') {
        await invoke('set_setting', { key: STORAGE_KEY, value: data });
        return;
      }
    } catch {
      // Fall back to localStorage
    }

    // localStorage fallback
    try {
      localStorage.setItem(STORAGE_KEY, data);
    } catch (e) {
      console.error('[RulefileLibrary] Failed to save to storage:', e);
    }
  }
}

// Singleton instance
export const rulefileLibrary = new RulefileLibrary();
