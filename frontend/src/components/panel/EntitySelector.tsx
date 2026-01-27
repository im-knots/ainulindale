/**
 * EntitySelector Component
 * Shows category and template selection for placing entities on hexes
 * Uses templateService for proper template definitions with system prompts
 */

import { useState, useEffect } from 'react';
import { Entity, EntityCategory, AgentEntity, ToolEntity, RBACConfig } from '../../store/types';
import { placeEntity } from '../../store/persistence';
import { useCurrentBoard } from '../../store/hooks';
import { templateService, Template } from '../../services/templateService';

// Default RBAC config with all-rw zone pattern (all 6 directions have read/write access)
const DEFAULT_RBAC_CONFIG: RBACConfig = {
  enabled: true,
  defaultRole: 'executor',
  defaultPermissions: ['read', 'execute'],
  zoneConfig: {
    readZone: [],
    writeZone: [],
    readWriteZone: ['E', 'NE', 'NW', 'W', 'SW', 'SE'],
    executeInAllZones: true,
  },
  useZones: true,
  accessGrants: [],
  denyList: [],
};

interface EntitySelectorProps {
  hexKey: string;
}

const CATEGORIES: { id: EntityCategory; label: string; icon: string; color: string }[] = [
  { id: 'agent', label: 'Agent', icon: 'A', color: 'text-entity-agent' },
  { id: 'tool', label: 'Tool', icon: 'T', color: 'text-entity-tool' },
];

export function EntitySelector({ hexKey }: EntitySelectorProps) {
  const currentBoard = useCurrentBoard();
  const [selectedCategory, setSelectedCategory] = useState<EntityCategory | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load templates when category is selected
  useEffect(() => {
    if (!selectedCategory) {
      setTemplates([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    templateService.getTemplatesByCategory(selectedCategory)
      .then((loadedTemplates) => {
        setTemplates(loadedTemplates);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[EntitySelector] Failed to load templates:', err);
        setError('Failed to load templates');
        setIsLoading(false);
      });
  }, [selectedCategory]);

  const handleSelectTemplate = async (template: Template) => {
    if (isPlacing) return;

    if (!currentBoard) {
      setError('No board selected. Please select or create a board first.');
      return;
    }

    setIsPlacing(true);
    setError(null);

    try {
      let entity: Entity;

      if (selectedCategory === 'agent') {
        // Build agent entity from template
        const agentEntity: AgentEntity = {
          id: '', // Will be assigned by database
          category: 'agent',
          name: template.name,
          cost: template.cost,
          status: 'idle',
          template: template.id,
          provider: 'anthropic',
          model: (template.config?.model as string) || 'claude-sonnet-4-20250514',
          systemPrompt: (template.config?.systemPrompt as string) || '',
          temperature: (template.config?.temperature as number) || 0.7,
        };
        entity = agentEntity;
      } else {
        // Build tool entity from template
        // Tool type comes from template config or falls back to template ID (plugin ID)
        const toolType = (template.config?.toolType as string) || template.id;
        const toolConfig = template.config ? { ...template.config } : {};
        const toolEntity: ToolEntity = {
          id: '', // Will be assigned by database
          category: 'tool',
          name: template.name,
          cost: template.cost,
          status: 'idle',
          toolType,
          config: toolConfig,
          isConfigured: false,
          range: 1,
          linkingMode: 'range',
          linkedHexes: [],
          rbacConfig: { ...DEFAULT_RBAC_CONFIG },
        };
        entity = toolEntity;
      }

      console.log('[EntitySelector] Placing entity:', entity.name, 'on hex:', hexKey);
      await placeEntity(hexKey, entity);
      console.log('[EntitySelector] Entity placed successfully');
    } catch (err) {
      console.error('[EntitySelector] Failed to place entity:', err);
      setError(err instanceof Error ? err.message : 'Failed to place entity');
    } finally {
      setIsPlacing(false);
    }
  };

  // Show error if no board
  if (!currentBoard) {
    return (
      <div className="p-4">
        <div className="p-3 bg-accent-danger/20 border border-accent-danger/50 rounded-lg">
          <p className="text-accent-danger text-sm">No board selected</p>
          <p className="text-text-muted text-xs mt-1">Please select or create a board first.</p>
        </div>
      </div>
    );
  }

  // Category selection
  if (!selectedCategory) {
    return (
      <div className="p-4">
        <h3 className="text-text-primary font-medium mb-4">Add Entity</h3>
        <div className="space-y-2">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className="w-full p-3 bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors text-left flex items-center gap-3"
            >
              <div className={`text-xl font-bold ${category.color}`}>
                {category.icon}
              </div>
              <span className="text-text-primary text-sm font-medium">{category.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Template selection
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setSelectedCategory(null)}
          className="p-1 text-text-muted hover:text-text-primary"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-text-primary font-medium">
          Select {selectedCategory === 'agent' ? 'Agent' : 'Tool'}
        </h3>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-accent-danger/20 border border-accent-danger/50 rounded text-accent-danger text-xs">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent-primary" />
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => handleSelectTemplate(template)}
              disabled={isPlacing}
              className="w-full p-3 bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors text-left disabled:opacity-50"
            >
              <div className="text-text-primary text-sm font-medium">{template.name}</div>
              <div className="text-text-muted text-xs mt-1">{template.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default EntitySelector;

