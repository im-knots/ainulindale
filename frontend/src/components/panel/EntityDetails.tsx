/**
 * EntityDetails Component
 * Shows configuration and details for the selected entity
 *
 * Includes:
 * - Entity header with status
 * - Agent config: provider/model with dynamic loading, rulefiles
 * - Tool config: filesystem paths, shell settings, tasklist management
 * - RBAC zone pattern configuration
 * - Range slider with live board preview
 * - Linking mode toggle (range vs explicit)
 * - Adjacency section showing resources in range
 * - Metrics display
 */

import { useState, useEffect } from 'react';
import { Entity, AgentEntity, ToolEntity, LinkingMode, EquippedRulefile, HexData } from '../../store/types';
import { useStoreActions, useHexes, useEntities } from '../../store/hooks';
import { removeEntity } from '../../store/persistence';
import { getResourcesInRange, getEntitiesInResourceRange, AdjacentResource } from '../../hex/adjacency';
import { ZonePattern, ZONE_PATTERNS, ZONE_PATTERN_INFO, DEFAULT_RBAC_CONFIG, Permission, PERMISSION_INFO } from '../../rbac/types';
import { getPermissions } from '../../rbac/permissions';
import { Entity as LegacyEntity } from '../../state/store';
import { llmClient } from '../../llm/client';
import { LLMProviderType, ModelInfo } from '../../llm/types';
import { rulefileLibrary } from '../../rulefiles';
import { pluginRegistry } from '../../engine/tools/plugin-registry';

// Provider display names
const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  cohere: 'Cohere',
  mistral: 'Mistral',
  grok: 'xAI Grok',
  ollama: 'Ollama',
  mock: 'Mock (Testing)',
};

// Status badge configuration
const STATUS_CONFIG: Record<string, { label: string; bgClass: string; textClass: string }> = {
  idle: { label: 'Idle', bgClass: 'bg-bg-tertiary', textClass: 'text-text-muted' },
  active: { label: 'Active', bgClass: 'bg-accent-success/20', textClass: 'text-accent-success' },
  busy: { label: 'Busy', bgClass: 'bg-accent-warning/20', textClass: 'text-accent-warning' },
  warning: { label: 'Warning', bgClass: 'bg-accent-warning/20', textClass: 'text-accent-warning' },
  error: { label: 'Error', bgClass: 'bg-accent-danger/20', textClass: 'text-accent-danger' },
  disabled: { label: 'Disabled', bgClass: 'bg-bg-tertiary', textClass: 'text-text-muted' },
};

interface EntityDetailsProps {
  entity: Entity;
  hexKey: string;
  onOpenRulefileModal?: () => void;
}

export function EntityDetails({ entity, hexKey, onOpenRulefileModal }: EntityDetailsProps) {
  const { updateEntity, setPreviewRange } = useStoreActions();
  // Use individual hooks instead of object selector to avoid infinite re-renders
  const hexes = useHexes();
  const entities = useEntities();

  const handleRemove = async () => {
    if (confirm('Remove this entity?')) {
      await removeEntity(entity.id);
    }
  };

  const statusConfig = STATUS_CONFIG[entity.status] || STATUS_CONFIG.idle;

  // Get tool access information for agents
  const stateForAdjacency = { hexes, entities };
  const resourcesInRange = entity.category === 'agent'
    ? getResourcesInRange(hexKey, stateForAdjacency as any)
    : [];

  // Get agents that can access this tool (for tools)
  const entitiesInRange = entity.category === 'tool'
    ? getEntitiesInResourceRange(entity.id, stateForAdjacency as any)
    : [];

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-text-primary font-medium">{entity.name}</h3>
          <p className="text-text-muted text-xs uppercase tracking-wide">
            {entity.category}
          </p>
        </div>
        <div className={`px-2 py-1 rounded text-xs uppercase flex items-center gap-1.5 ${statusConfig.bgClass} ${statusConfig.textClass}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {statusConfig.label}
        </div>
      </div>

      {/* Entity-specific configuration */}
      {entity.category === 'agent' ? (
        <AgentConfig
          entity={entity as AgentEntity}
          onUpdate={updateEntity}
          onOpenRulefileModal={onOpenRulefileModal}
        />
      ) : (
        <ToolConfig
          entity={entity as ToolEntity}
          onUpdate={updateEntity}
          setPreviewRange={setPreviewRange}
        />
      )}

      {/* Tool Access Section (for agents - shows tools they can access) */}
      <AdjacencySection
        entity={entity}
        hexKey={hexKey}
        entities={entities}
        resourcesInRange={resourcesInRange}
      />

      {/* Agent Access Section (for tools - shows agents that can access them) */}
      <ToolAccessSection
        entity={entity}
        hexKey={hexKey}
        hexes={hexes}
        entitiesInRange={entitiesInRange as any}
      />

      {/* Metrics */}
      <MetricsSection entity={entity} />

      {/* Remove button */}
      <button
        onClick={handleRemove}
        className="w-full py-2 text-sm text-accent-danger hover:bg-accent-danger/10 rounded-md transition-colors flex items-center justify-center gap-2"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        Remove Entity
      </button>
    </div>
  );
}

// ============ Agent Configuration ============

interface AgentConfigProps {
  entity: AgentEntity;
  onUpdate: (id: string, updates: Partial<Entity>) => void;
  onOpenRulefileModal?: () => void;
}

function AgentConfig({ entity, onUpdate, onOpenRulefileModal }: AgentConfigProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const currentProvider = (entity.provider || 'mock') as LLMProviderType;
  const configuredProviders = llmClient.getConfiguredProviders();

  // Load models when provider changes
  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      setLoadingModels(true);
      setModelError(null);
      try {
        const loadedModels = await llmClient.getModelsForProvider(currentProvider);
        if (!cancelled) {
          setModels(loadedModels);
          setModelError(null);
        }
      } catch (error) {
        console.warn(`Failed to load models for ${currentProvider}:`, error);
        if (!cancelled) {
          setModels([]);
          setModelError(error instanceof Error ? error.message : `Failed to load models from ${currentProvider}`);
        }
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    }

    loadModels();
    return () => { cancelled = true; };
  }, [currentProvider]);

  const handleProviderChange = (provider: string) => {
    onUpdate(entity.id, { provider } as Partial<AgentEntity>);
  };

  const handleModelChange = (model: string) => {
    onUpdate(entity.id, { model } as Partial<AgentEntity>);
  };

  const hasConfiguredProviders = configuredProviders.filter(p => p !== 'mock').length > 0;

  return (
    <div className="space-y-4">
      {/* Model Configuration Section */}
      <div className="space-y-3 p-3 bg-bg-tertiary/50 rounded-lg border border-border/50">
        <div className="flex items-center gap-2 text-text-primary text-sm font-medium">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-info">
            <path d="M12 2a10 10 0 1 0 10 10H12V2z"/>
            <circle cx="12" cy="12" r="6"/>
          </svg>
          Model
        </div>

        {!hasConfiguredProviders && (
          <div className="flex items-center gap-2 p-2.5 bg-accent-warning/10 border border-accent-warning/20 rounded-md text-accent-warning text-xs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Add API keys in Settings to enable providers
          </div>
        )}

        {/* Provider */}
        <div>
          <label className="text-text-muted text-xs uppercase tracking-wide block mb-1.5">Provider</label>
          <select
            value={currentProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary hover:border-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50 transition-colors cursor-pointer appearance-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1.25rem' }}
          >
            {configuredProviders.map(p => (
              <option key={p} value={p}>{PROVIDER_NAMES[p] || p}</option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="text-text-muted text-xs uppercase tracking-wide block mb-1.5">Model</label>

          {modelError ? (
            <div className="flex items-center gap-2 p-2.5 bg-accent-danger/10 border border-accent-danger/20 rounded-md text-accent-danger text-xs">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {modelError}
            </div>
          ) : (
            <div className="relative">
              <select
                value={entity.model}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={loadingModels}
                className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary hover:border-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
                style={{ backgroundImage: loadingModels ? 'none' : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1.25rem' }}
              >
                {models.length > 0 ? (
                  models.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))
                ) : (
                  <option value={entity.model}>{entity.model}</option>
                )}
              </select>
              {loadingModels && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Equipped Rules Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-text-secondary text-sm font-medium">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          Equipped Rules
        </div>

        <EquippedRulefilesDisplay
          equipped={entity.equippedRulefiles || []}
          entity={entity}
          onUpdate={onUpdate}
        />

        <button
          onClick={onOpenRulefileModal}
          className="w-full py-2 text-sm bg-bg-tertiary hover:bg-border text-text-secondary rounded-md transition-colors"
        >
          Manage Rules
        </button>
      </div>
    </div>
  );
}

interface EquippedRulefilesDisplayProps {
  equipped: EquippedRulefile[];
  entity: AgentEntity;
  onUpdate: (entityId: string, updates: Partial<AgentEntity>) => void;
}

function EquippedRulefilesDisplay({ equipped, entity, onUpdate }: EquippedRulefilesDisplayProps) {
  const enabledCount = equipped.filter(eq => eq.enabled).length;

  const handleUnequip = (rulefileId: string) => {
    const newEquipped = equipped.filter(eq => eq.rulefileId !== rulefileId);
    onUpdate(entity.id, { equippedRulefiles: newEquipped });
  };

  if (equipped.length === 0) {
    return (
      <div className="text-text-muted text-xs italic p-2 bg-bg-tertiary rounded">
        No rules equipped. Click "Manage Rules" to add rules.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {equipped.slice(0, 3).map(eq => {
        const rf = rulefileLibrary.get(eq.rulefileId);
        if (!rf) return null;
        return (
          <div
            key={eq.rulefileId}
            className={`flex items-center justify-between gap-2 p-2 bg-bg-tertiary rounded text-xs ${eq.enabled ? '' : 'opacity-50'}`}
          >
            <span className="text-text-primary truncate flex-1">{rf.name}</span>
            <button
              onClick={() => handleUnequip(eq.rulefileId)}
              className="text-text-muted hover:text-accent-danger transition-colors shrink-0"
              title="Unequip rulefile"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        );
      })}
      {equipped.length > 3 && (
        <div className="text-text-muted text-xs text-center">
          +{equipped.length - 3} more
        </div>
      )}
      <div className="text-text-muted text-xs">
        {enabledCount} rulefile{enabledCount !== 1 ? 's' : ''} active
      </div>
    </div>
  );
}

// ============ Tool Configuration ============

interface ToolConfigProps {
  entity: ToolEntity;
  onUpdate: (id: string, updates: Partial<Entity>) => void;
  setPreviewRange: (range: number | null) => void;
}

function ToolConfig({ entity, onUpdate, setPreviewRange }: ToolConfigProps) {
  // Default values for properties that might be undefined from database
  const entityRange = entity.range ?? 1;
  const entityLinkingMode = entity.linkingMode ?? 'range';

  const [localRange, setLocalRange] = useState(entityRange);

  // Sync local range with entity range
  useEffect(() => {
    setLocalRange(entityRange);
  }, [entityRange]);

  const handleRangeInput = (value: number) => {
    setLocalRange(value);
    setPreviewRange(value);
  };

  const handleRangeChange = (value: number) => {
    setPreviewRange(null);
    onUpdate(entity.id, { range: value } as Partial<ToolEntity>);
  };

  const handleLinkingModeChange = (mode: LinkingMode) => {
    onUpdate(entity.id, { linkingMode: mode } as Partial<ToolEntity>);
  };

  const handleZonePatternChange = (pattern: ZonePattern) => {
    const zoneConfig = ZONE_PATTERNS[pattern];
    const currentConfig = entity.rbacConfig || DEFAULT_RBAC_CONFIG;
    onUpdate(entity.id, {
      rbacConfig: {
        ...currentConfig,
        useZones: true,
        zoneConfig,
      }
    } as Partial<ToolEntity>);
  };

  const isRangeMode = entityLinkingMode === 'range';
  const currentPattern = detectZonePattern(entity);

  return (
    <div className="space-y-4">
      {/* Access Control Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-text-secondary text-sm font-medium">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Access Control
        </div>

        {/* Linking Mode Toggle */}
        <div>
          <label className="text-text-muted text-xs block mb-1">Linking Mode</label>
          <div className="flex rounded-md overflow-hidden border border-border">
            <button
              onClick={() => handleLinkingModeChange('range')}
              className={`flex-1 py-1.5 text-xs transition-colors ${
                isRangeMode
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
              }`}
            >
              Range
            </button>
            <button
              onClick={() => handleLinkingModeChange('explicit')}
              className={`flex-1 py-1.5 text-xs transition-colors ${
                !isRangeMode
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
              }`}
            >
              Explicit
            </button>
          </div>
          <p className="text-text-muted text-xs mt-1">
            {isRangeMode ? 'Access based on hex distance' : 'Manual links to specific hexes'}
          </p>
        </div>

        {isRangeMode ? (
          <>
            {/* Range Slider */}
            <div>
              <label className="text-text-muted text-xs block mb-1">
                Range: <span className="text-text-primary">{localRange}</span>
              </label>
              <input
                type="range"
                min="1"
                max="5"
                value={localRange}
                onInput={(e) => handleRangeInput(parseInt((e.target as HTMLInputElement).value))}
                onChange={(e) => handleRangeChange(parseInt(e.target.value))}
                className="w-full accent-accent-primary"
              />
            </div>

            {/* Zone Pattern */}
            <div>
              <label className="text-text-muted text-xs uppercase tracking-wide block mb-1.5">Zone Pattern</label>
              <select
                value={currentPattern}
                onChange={(e) => handleZonePatternChange(e.target.value as ZonePattern)}
                className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary hover:border-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50 transition-colors cursor-pointer appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1.25rem' }}
              >
                {Object.entries(ZONE_PATTERN_INFO).map(([pattern, info]) => (
                  <option key={pattern} value={pattern}>{info.name}</option>
                ))}
              </select>
            </div>
          </>
        ) : (
          /* Linked Hexes (Explicit Mode) */
          <div>
            <label className="text-text-muted text-xs block mb-1">Linked Hexes</label>
            <div className="flex flex-wrap gap-1 min-h-[2rem] p-2 bg-bg-tertiary rounded">
              {(entity.linkedHexes?.length ?? 0) > 0 ? (
                (entity.linkedHexes ?? []).map(h => (
                  <span key={h} className="px-2 py-0.5 bg-bg-primary rounded text-xs text-text-secondary">
                    {h}
                  </span>
                ))
              ) : (
                <span className="text-text-muted text-xs italic">
                  Shift+click hexes to link
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tool-specific Configuration - data-driven based on plugin registry */}
      {(() => {
        const plugin = pluginRegistry.get(entity.toolType);
        if (!plugin?.ui?.hasConfigPanel) return null;

        // Config component lookup - still using a mapping, but the decision
        // to render is driven by plugin metadata
        const ConfigComponent = TOOL_CONFIG_COMPONENTS[entity.toolType];
        if (!ConfigComponent) return null;

        return <ConfigComponent entity={entity} onUpdate={onUpdate} />;
      })()}
    </div>
  );
}

function detectZonePattern(tool: ToolEntity): ZonePattern {
  const config = tool.rbacConfig;
  if (!config?.zoneConfig) return 'all-rw';

  const zc = config.zoneConfig;

  // Helper to check if two arrays have the same elements (order-independent)
  const arraysMatch = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, idx) => val === sortedB[idx]);
  };

  // Compare against all defined zone patterns from ZONE_PATTERNS
  for (const [patternName, patternConfig] of Object.entries(ZONE_PATTERNS)) {
    if (
      arraysMatch(zc.readZone || [], patternConfig.readZone) &&
      arraysMatch(zc.writeZone || [], patternConfig.writeZone) &&
      arraysMatch(zc.readWriteZone || [], patternConfig.readWriteZone)
    ) {
      return patternName as ZonePattern;
    }
  }

  // Default fallback
  return 'all-rw';
}

// ============ Tool-Specific Configs ============

function FilesystemConfig({ entity, onUpdate }: { entity: ToolEntity; onUpdate: (id: string, updates: Partial<Entity>) => void }) {
  const config = entity.config as { rootPath?: string };

  const handlePathChange = (rootPath: string) => {
    const isConfigured = rootPath.trim().length > 0;
    onUpdate(entity.id, {
      config: { ...entity.config, rootPath },
      isConfigured
    } as Partial<ToolEntity>);
  };

  const handleBrowse = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Directory',
      });

      if (selected && typeof selected === 'string') {
        handlePathChange(selected);
      }
    } catch (error) {
      console.warn('Tauri dialog not available:', error);
    }
  };

  return (
    <div className="space-y-3 p-3 bg-bg-tertiary/50 rounded-lg border border-border/50">
      <div className="flex items-center gap-2 text-text-primary text-sm font-medium">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-info">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        Filesystem
      </div>

      <div>
        <label className="text-text-muted text-xs uppercase tracking-wide block mb-1.5">Root Path</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={config.rootPath || ''}
            onChange={(e) => handlePathChange(e.target.value)}
            placeholder="/path/to/workspace"
            className="flex-1 bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary hover:border-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50 transition-colors"
          />
          <button
            onClick={handleBrowse}
            className="px-3 py-2 bg-bg-primary border border-border rounded-md text-sm text-text-secondary hover:border-text-muted hover:text-text-primary transition-colors"
          >
            Browse
          </button>
        </div>
      </div>

    </div>
  );
}

function ShellConfig({ entity, onUpdate }: { entity: ToolEntity; onUpdate: (id: string, updates: Partial<Entity>) => void }) {
  const config = entity.config as { shell?: string; allowedCommands?: string[] };

  return (
    <div className="space-y-3 p-3 bg-bg-tertiary/50 rounded-lg border border-border/50">
      <div className="flex items-center gap-2 text-text-primary text-sm font-medium">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-info">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        Shell
      </div>

      <div>
        <label className="text-text-muted text-xs uppercase tracking-wide block mb-1.5">Provider</label>
        <select
          value={config.shell || 'system'}
          onChange={(e) => onUpdate(entity.id, {
            config: { ...entity.config, shell: e.target.value }
          } as Partial<ToolEntity>)}
          className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary hover:border-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50 transition-colors cursor-pointer appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1.25rem' }}
        >
          <option value="system">System Default</option>
          <option value="bash">Bash</option>
          <option value="zsh">Zsh</option>
          <option value="powershell">PowerShell</option>
        </select>
      </div>

      <div>
        <label className="text-text-muted text-xs uppercase tracking-wide block mb-1.5">Allowed Commands</label>
        <textarea
          value={(config.allowedCommands || []).join('\n')}
          onChange={(e) => {
            const allowedCommands = e.target.value.split('\n').map(s => s.trim()).filter(s => s);
            onUpdate(entity.id, {
              config: { ...entity.config, allowedCommands }
            } as Partial<ToolEntity>);
          }}
          placeholder="Leave empty to allow all commands (one per line)"
          rows={3}
          className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 text-sm text-text-primary hover:border-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/50 transition-colors resize-none"
        />
      </div>
    </div>
  );
}

function TasklistConfig({ entity }: { entity: ToolEntity; onUpdate: (id: string, updates: Partial<Entity>) => void }) {
  const config = entity.config as { tasks?: Array<{ title: string; completed: boolean }> };
  const taskCount = (config.tasks || []).length;
  const pendingCount = (config.tasks || []).filter(t => !t.completed).length;
  const completedCount = taskCount - pendingCount;

  return (
    <div className="space-y-3 p-3 bg-bg-tertiary/50 rounded-lg border border-border/50">
      <div className="flex items-center gap-2 text-text-primary text-sm font-medium">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-info">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        Task Queue
      </div>

      {/* Summary stats */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-text-muted">
          <span className="text-accent-warning font-medium">{pendingCount}</span> pending
        </span>
        <span className="text-text-muted">
          <span className="text-accent-success font-medium">{completedCount}</span> done
        </span>
      </div>

      {/* Direction to bottom bar */}
      <div className="text-text-muted text-xs flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M19 12l-7 7-7-7"/>
        </svg>
        Manage tasks in the bottom panel
      </div>
    </div>
  );
}

// ============ Tool Config Component Mapping ============
// Maps plugin IDs to their config panel components
// New plugins can be added here without modifying the rendering logic
type ToolConfigPanelProps = { entity: ToolEntity; onUpdate: (id: string, updates: Partial<Entity>) => void };
const TOOL_CONFIG_COMPONENTS: Record<string, React.FC<ToolConfigPanelProps>> = {
  filesystem: FilesystemConfig,
  shell: ShellConfig,
  tasklist: TasklistConfig,
};

// ============ Adjacency Section ============

// Permission badge component
function PermissionBadge({ permission, granted }: { permission: string; granted: boolean }) {
  if (!granted) return null;

  const colors: Record<string, string> = {
    read: 'bg-accent-info/20 text-accent-info border-accent-info/30',
    write: 'bg-accent-warning/20 text-accent-warning border-accent-warning/30',
    execute: 'bg-accent-success/20 text-accent-success border-accent-success/30',
    admin: 'bg-accent-danger/20 text-accent-danger border-accent-danger/30',
  };

  const labels: Record<string, string> = {
    read: 'R',
    write: 'W',
    execute: 'X',
    admin: 'A',
  };

  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors[permission] || 'bg-bg-tertiary text-text-muted'}`}
      title={PERMISSION_INFO[permission as Permission]?.description || permission}
    >
      {labels[permission] || permission.charAt(0).toUpperCase()}
    </span>
  );
}

interface AdjacencySectionProps {
  entity: Entity;
  hexKey: string;
  entities: Map<string, Entity>;
  resourcesInRange: AdjacentResource[];
}

function AdjacencySection({ entity, hexKey, entities, resourcesInRange }: AdjacencySectionProps) {
  const hasResources = resourcesInRange.length > 0;

  // Only show for agents with tool access
  if (entity.category !== 'agent' || !hasResources) return null;

  return (
    <div className="space-y-3 p-3 bg-bg-tertiary/50 rounded-lg border border-border/50">
      <div className="flex items-center gap-2 text-text-primary text-sm font-medium">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-info">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Tool Access
      </div>

      <div className="space-y-1.5">
        {resourcesInRange.map(r => {
          // Get the tool entity to check RBAC permissions
          const toolEntity = entities.get(r.entityId);
          // Get permissions for this agent from this tool
          const permissions = toolEntity
            ? getPermissions(hexKey, toolEntity as LegacyEntity, r.hexKey)
            : [];

          return (
            <div
              key={r.entityId}
              className="flex items-center justify-between p-2 bg-bg-primary rounded-md text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-text-primary font-medium">{r.name}</span>
                <span className="text-text-muted text-[10px] uppercase">{r.type}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Permission badges */}
                <PermissionBadge permission="read" granted={permissions.includes('read')} />
                <PermissionBadge permission="write" granted={permissions.includes('write')} />
                <PermissionBadge permission="execute" granted={permissions.includes('execute')} />
                {/* Only show distance if > 1 */}
                {r.distance > 1 && (
                  <span className="px-1.5 py-0.5 bg-bg-tertiary rounded text-text-muted text-[10px] ml-1">
                    d={r.distance}
                  </span>
                )}
                {/* Show linked indicator for explicit links */}
                {r.isExplicitLink && (
                  <span className="px-1.5 py-0.5 bg-accent-primary/20 text-accent-primary rounded text-[10px]">
                    Linked
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ Tool Access Section (for tools - shows agents that can access them) ============

interface ToolAccessSectionProps {
  entity: Entity;
  hexKey: string;
  hexes: Map<string, HexData>;
  entitiesInRange: { entity: Entity; distance: number; isExplicitLink: boolean }[];
}

function ToolAccessSection({ entity, hexKey, hexes, entitiesInRange }: ToolAccessSectionProps) {
  // Only show for tools with agents in range
  if (entity.category !== 'tool' || entitiesInRange.length === 0) return null;

  // Filter to only show agents (not other tools)
  const agentsInRange = entitiesInRange.filter(e => e.entity.category === 'agent');
  if (agentsInRange.length === 0) return null;

  const toolEntity = entity as ToolEntity;

  // Build a reverse lookup: entityId -> hexKey
  const entityToHexKey = new Map<string, string>();
  for (const [hKey, hex] of hexes) {
    if (hex.entityId) {
      entityToHexKey.set(hex.entityId, hKey);
    }
  }

  return (
    <div className="space-y-3 p-3 bg-bg-tertiary/50 rounded-lg border border-border/50">
      <div className="flex items-center gap-2 text-text-primary text-sm font-medium">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-entity-agent">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        Agent Access
      </div>

      <div className="space-y-1.5">
        {agentsInRange.map(({ entity: agentEntity, distance, isExplicitLink }) => {
          // Find the agent's hex key from the lookup
          const agentHexKey = entityToHexKey.get(agentEntity.id) || '';

          // Get permissions for this agent from this tool
          const permissions = getPermissions(agentHexKey, toolEntity as LegacyEntity, hexKey);

          return (
            <div
              key={agentEntity.id}
              className="flex items-center justify-between p-2 bg-bg-primary rounded-md text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-text-primary font-medium">{agentEntity.name}</span>
                <span className="text-text-muted text-[10px] uppercase">agent</span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Permission badges */}
                <PermissionBadge permission="read" granted={permissions.includes('read')} />
                <PermissionBadge permission="write" granted={permissions.includes('write')} />
                <PermissionBadge permission="execute" granted={permissions.includes('execute')} />
                {/* Only show distance if > 1 */}
                {distance > 1 && (
                  <span className="px-1.5 py-0.5 bg-bg-tertiary rounded text-text-muted text-[10px] ml-1">
                    d={distance}
                  </span>
                )}
                {/* Show linked indicator for explicit links */}
                {isExplicitLink && (
                  <span className="px-1.5 py-0.5 bg-accent-primary/20 text-accent-primary rounded text-[10px]">
                    Linked
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ Metrics Section ============

function MetricsSection({ entity }: { entity: Entity }) {
  const metrics = entity.metrics;
  if (!metrics) return null;

  return (
    <div className="pt-4 border-t border-border">
      <h4 className="text-text-secondary text-sm font-medium mb-2">Run Metrics</h4>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-text-muted">Cost:</span>
          <span className="text-text-primary ml-2">
            ${metrics.runCost?.toFixed(4) ?? '0.00'}
          </span>
        </div>
        <div>
          <span className="text-text-muted">Tokens:</span>
          <span className="text-text-primary ml-2">
            {metrics.runTokens ?? 0}
          </span>
        </div>
        {metrics.throughput > 0 && (
          <div>
            <span className="text-text-muted">Throughput:</span>
            <span className="text-text-primary ml-2">
              {metrics.throughput.toFixed(1)}/hr
            </span>
          </div>
        )}
        {metrics.errorRate > 0 && (
          <div>
            <span className="text-text-muted">Error Rate:</span>
            <span className="text-accent-danger ml-2">
              {(metrics.errorRate * 100).toFixed(1)}%
            </span>
          </div>
        )}
        {metrics.latencyMs > 0 && (
          <div>
            <span className="text-text-muted">Latency:</span>
            <span className="text-text-primary ml-2">
              {metrics.latencyMs.toFixed(0)}ms
            </span>
          </div>
        )}
        {metrics.utilization > 0 && (
          <div>
            <span className="text-text-muted">Utilization:</span>
            <span className="text-text-primary ml-2">
              {(metrics.utilization * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default EntityDetails;

