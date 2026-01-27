/**
 * RulefileModal Component
 * Modal for browsing, creating, and managing rulefiles
 */

import { useState, useEffect, useMemo } from 'react';
import {
  rulefileLibrary,
  Rulefile,
  RulefileCategory,
  RULEFILE_CATEGORY_INFO,
} from '../../rulefiles';
import { AgentEntity } from '../../store/types';

interface RulefileModalProps {
  agent: AgentEntity;
  onClose: () => void;
  onEquipChange: (rulefileIds: string[]) => void;
}

type CategoryFilter = RulefileCategory | 'all';

export function RulefileModal({ agent, onClose, onEquipChange }: RulefileModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');
  const [selectedRulefileId, setSelectedRulefileId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContent, setEditContent] = useState('');
  const [equippedIds, setEquippedIds] = useState<Set<string>>(() => {
    return new Set(
      (agent.equippedRulefiles || [])
        .filter(eq => eq.enabled)
        .map(eq => eq.rulefileId)
    );
  });

  // Initialize library on mount
  useEffect(() => {
    rulefileLibrary.initialize();
  }, []);

  // Get filtered rulefiles
  const rulefiles = useMemo(() => {
    let list = rulefileLibrary.getAll();

    if (selectedCategory !== 'all') {
      list = list.filter(rf => rf.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(rf =>
        rf.name.toLowerCase().includes(query) ||
        rf.description.toLowerCase().includes(query) ||
        rf.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    return list;
  }, [selectedCategory, searchQuery]);

  const selectedRulefile = selectedRulefileId
    ? rulefileLibrary.get(selectedRulefileId) ?? null
    : null;

  const handleSelectRulefile = (id: string) => {
    setSelectedRulefileId(id);
    setIsEditing(false);
  };

  const handleToggleEquip = (id: string) => {
    setEquippedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreateNew = async () => {
    const newRulefile = await rulefileLibrary.create('New Rulefile', 'custom', '');
    setSelectedRulefileId(newRulefile.id);
    setIsEditing(true);
    setEditName(newRulefile.name);
    setEditDescription(newRulefile.description);
    setEditContent(newRulefile.content);
  };

  const handleStartEdit = () => {
    if (selectedRulefile && !selectedRulefile.isBuiltin) {
      setIsEditing(true);
      setEditName(selectedRulefile.name);
      setEditDescription(selectedRulefile.description);
      setEditContent(selectedRulefile.content);
    }
  };

  const handleSaveEdit = async () => {
    if (selectedRulefileId) {
      await rulefileLibrary.update(selectedRulefileId, {
        name: editName,
        description: editDescription,
        content: editContent,
      });
      setIsEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (selectedRulefileId && confirm('Delete this rulefile?')) {
      await rulefileLibrary.delete(selectedRulefileId);
      equippedIds.delete(selectedRulefileId);
      setEquippedIds(new Set(equippedIds));
      setSelectedRulefileId(null);
    }
  };

  const handleApply = () => {
    onEquipChange(Array.from(equippedIds));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-secondary border border-border rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-text-primary font-medium">Rulefile Library</h2>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <RulefileSidebar
            categories={Object.keys(RULEFILE_CATEGORY_INFO) as RulefileCategory[]}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            rulefiles={rulefiles}
            selectedRulefileId={selectedRulefileId}
            equippedIds={equippedIds}
            onSelectRulefile={handleSelectRulefile}
            onCreateNew={handleCreateNew}
          />

          {/* Content */}
          <RulefileContent
            rulefile={selectedRulefile}
            isEditing={isEditing}
            editName={editName}
            editDescription={editDescription}
            editContent={editContent}
            isEquipped={selectedRulefileId ? equippedIds.has(selectedRulefileId) : false}
            onEditNameChange={setEditName}
            onEditDescriptionChange={setEditDescription}
            onEditContentChange={setEditContent}
            onStartEdit={handleStartEdit}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            onDelete={handleDelete}
            onToggleEquip={() => selectedRulefileId && handleToggleEquip(selectedRulefileId)}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border shrink-0">
          <div className="text-text-muted text-sm">
            {equippedIds.size} rulefile{equippedIds.size !== 1 ? 's' : ''} equipped
          </div>
          <button onClick={handleApply} className="btn btn-primary">
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// Sidebar component
interface RulefileSidebarProps {
  categories: RulefileCategory[];
  selectedCategory: CategoryFilter;
  onSelectCategory: (cat: CategoryFilter) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  rulefiles: Rulefile[];
  selectedRulefileId: string | null;
  equippedIds: Set<string>;
  onSelectRulefile: (id: string) => void;
  onCreateNew: () => void;
}

function RulefileSidebar({
  categories,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  rulefiles,
  selectedRulefileId,
  equippedIds,
  onSelectRulefile,
  onCreateNew,
}: RulefileSidebarProps) {
  return (
    <div className="w-64 border-r border-border flex flex-col shrink-0">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search rulefiles..."
          className="input w-full text-sm"
        />
      </div>

      {/* Categories */}
      <div className="p-2 border-b border-border flex flex-wrap gap-1">
        <button
          onClick={() => onSelectCategory('all')}
          className={`px-2 py-1 text-xs rounded ${
            selectedCategory === 'all'
              ? 'bg-accent-primary text-white'
              : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => onSelectCategory(cat)}
            className={`px-2 py-1 text-xs rounded ${
              selectedCategory === cat
                ? 'bg-accent-primary text-white'
                : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
            }`}
          >
            {RULEFILE_CATEGORY_INFO[cat].icon}
          </button>
        ))}
      </div>

      {/* Rulefile list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {rulefiles.map((rf) => (
          <button
            key={rf.id}
            onClick={() => onSelectRulefile(rf.id)}
            className={`w-full text-left p-2 rounded text-sm ${
              selectedRulefileId === rf.id
                ? 'bg-accent-primary/20 text-text-primary'
                : 'text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            <div className="flex items-center gap-2">
              {equippedIds.has(rf.id) && (
                <span className="text-accent-success text-xs">*</span>
              )}
              <span className="truncate">{rf.name}</span>
              {rf.isBuiltin && (
                <span className="text-xs text-text-muted">(builtin)</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Create button */}
      <div className="p-2 border-t border-border">
        <button
          onClick={onCreateNew}
          className="w-full py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded"
        >
          + New Rulefile
        </button>
      </div>
    </div>
  );
}


// Content component
interface RulefileContentProps {
  rulefile: Rulefile | null;
  isEditing: boolean;
  editName: string;
  editDescription: string;
  editContent: string;
  isEquipped: boolean;
  onEditNameChange: (name: string) => void;
  onEditDescriptionChange: (desc: string) => void;
  onEditContentChange: (content: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onToggleEquip: () => void;
}

function RulefileContent({
  rulefile,
  isEditing,
  editName,
  editDescription,
  editContent,
  isEquipped,
  onEditNameChange,
  onEditDescriptionChange,
  onEditContentChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onToggleEquip,
}: RulefileContentProps) {
  if (!rulefile) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p>Select a rulefile to view its contents</p>
        </div>
      </div>
    );
  }

  const catInfo = RULEFILE_CATEGORY_INFO[rulefile.category];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {isEditing ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => onEditNameChange(e.target.value)}
                className="input text-lg font-medium w-full mb-2"
              />
            ) : (
              <h3 className="text-text-primary text-lg font-medium">{rulefile.name}</h3>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="px-2 py-0.5 bg-bg-tertiary rounded text-xs text-text-muted">
                {catInfo.icon} {catInfo.name}
              </span>
              {rulefile.isBuiltin && (
                <span className="px-2 py-0.5 bg-accent-primary/20 rounded text-xs text-accent-primary">
                  Builtin
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleEquip}
              className={`px-3 py-1.5 rounded text-sm ${
                isEquipped
                  ? 'bg-accent-success/20 text-accent-success'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
              }`}
            >
              {isEquipped ? 'Equipped' : 'Equip'}
            </button>
          </div>
        </div>
        {isEditing ? (
          <textarea
            value={editDescription}
            onChange={(e) => onEditDescriptionChange(e.target.value)}
            placeholder="Description..."
            className="input w-full mt-2 text-sm"
            rows={2}
          />
        ) : (
          rulefile.description && (
            <p className="text-text-muted text-sm mt-2">{rulefile.description}</p>
          )
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            placeholder="Write your rulefile content in markdown..."
            className="w-full h-full min-h-[300px] bg-bg-tertiary border border-border rounded-md p-3 text-text-primary text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        ) : (
          <pre className="text-text-secondary text-sm whitespace-pre-wrap font-mono">
            {rulefile.content || 'No content defined'}
          </pre>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border flex justify-between">
        <div>
          {!rulefile.isBuiltin && !isEditing && (
            <button
              onClick={onDelete}
              className="text-sm text-accent-danger hover:underline"
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <button onClick={onCancelEdit} className="btn btn-secondary text-sm">
                Cancel
              </button>
              <button onClick={onSaveEdit} className="btn btn-primary text-sm">
                Save
              </button>
            </>
          ) : (
            !rulefile.isBuiltin && (
              <button onClick={onStartEdit} className="btn btn-secondary text-sm">
                Edit
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default RulefileModal;

