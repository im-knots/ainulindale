// Template service - local template catalog (no external service needed)

import * as localTemplates from '../data/templates';

export interface TemplateConfig {
  [key: string]: unknown;
}

export interface Template {
  id: string;
  category: string;
  name: string;
  description: string;
  icon: string;
  cost: number;
  config?: TemplateConfig;
  schema?: TemplateConfig;
  isBuiltin: boolean;
}

export interface CategoryInfo {
  category: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

export interface TemplatesByCategory {
  category: CategoryInfo;
  templates: Template[];
}

// Custom templates stored in localStorage
const CUSTOM_TEMPLATES_KEY = 'ainu:custom-templates';

class TemplateService {
  private customTemplates: Template[] = [];

  constructor() {
    this.loadCustomTemplates();
  }

  private loadCustomTemplates(): void {
    try {
      const stored = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
      if (stored) {
        this.customTemplates = JSON.parse(stored);
      }
    } catch {
      this.customTemplates = [];
    }
  }

  private saveCustomTemplates(): void {
    localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(this.customTemplates));
  }

  async getAllTemplates(): Promise<TemplatesByCategory[]> {
    const builtinTemplates = localTemplates.getAllTemplates();

    // Merge custom templates into their categories
    return builtinTemplates.map(({ category, templates }) => ({
      category,
      templates: [
        ...templates,
        ...this.customTemplates.filter(t => t.category === category.category),
      ],
    }));
  }

  async getTemplatesByCategory(category: string): Promise<Template[]> {
    const builtin = localTemplates.getTemplatesByCategory(category);
    const custom = this.customTemplates.filter(t => t.category === category);
    return [...builtin, ...custom];
  }

  async getTemplate(category: string, id: string): Promise<Template | null> {
    // Check builtin templates first
    const builtin = localTemplates.getTemplate(category, id);
    if (builtin) return builtin;

    // Check custom templates
    return this.customTemplates.find(t => t.category === category && t.id === id) || null;
  }

  async createTemplate(template: Omit<Template, 'id' | 'isBuiltin'>): Promise<Template> {
    const newTemplate: Template = {
      ...template,
      id: `custom-${Date.now()}`,
      isBuiltin: false,
    };
    this.customTemplates.push(newTemplate);
    this.saveCustomTemplates();
    return newTemplate;
  }

  async updateTemplate(id: string, updates: Partial<Template>): Promise<Template> {
    const index = this.customTemplates.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Template not found: ${id}`);
    }

    this.customTemplates[index] = { ...this.customTemplates[index], ...updates };
    this.saveCustomTemplates();
    return this.customTemplates[index];
  }

  async deleteTemplate(id: string): Promise<void> {
    const index = this.customTemplates.findIndex(t => t.id === id);
    if (index !== -1) {
      this.customTemplates.splice(index, 1);
      this.saveCustomTemplates();
    }
  }

  // Always available - no external service needed
  async isAvailable(): Promise<boolean> {
    return true;
  }

  clearCache(): void {
    // No-op for local templates
  }
}

export const templateService = new TemplateService();

