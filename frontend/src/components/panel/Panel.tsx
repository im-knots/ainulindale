/**
 * Panel Component
 * Right-side panel showing entity details or entity selector
 *
 * Includes:
 * - Empty state when no hex selected
 * - Entity selector flow (category → template)
 * - Entity details with configuration
 * - RulefileModal integration for agents
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSelectedHexKey, useSelectedEntity } from '../../store/hooks';
import { useStore } from '../../store';
import { EntityDetails } from './EntityDetails';
import { EntitySelector } from './EntitySelector';
import { RulefileModal } from '../modals/RulefileModal';
import { AgentEntity, EquippedRulefile } from '../../store/types';

export function Panel() {
  const selectedHexKey = useSelectedHexKey();
  const selectedEntity = useSelectedEntity();
  const updateEntity = useStore((s) => s.updateEntity);
  const [showRulefileModal, setShowRulefileModal] = useState(false);

  // Track previous entity to avoid unnecessary re-renders
  const lastEntityHash = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);

  // Save scroll position before entity changes
  useEffect(() => {
    if (scrollRef.current) {
      lastScrollTop.current = scrollRef.current.scrollTop;
    }
  });

  // Compute entity hash to detect actual changes
  const entityHash = selectedEntity ? JSON.stringify({
    id: selectedEntity.id,
    name: selectedEntity.name,
    status: selectedEntity.status,
    // Include config-related fields but not metrics (they change frequently)
    ...(selectedEntity.category === 'agent'
      ? { provider: (selectedEntity as AgentEntity).provider, model: (selectedEntity as AgentEntity).model }
      : {}
    )
  }) : null;

  // Restore scroll position if entity hash hasn't changed
  useEffect(() => {
    if (entityHash === lastEntityHash.current && scrollRef.current) {
      scrollRef.current.scrollTop = lastScrollTop.current;
    }
    lastEntityHash.current = entityHash;
  }, [entityHash]);

  const handleOpenRulefileModal = useCallback(() => {
    setShowRulefileModal(true);
  }, []);

  const handleCloseRulefileModal = useCallback(() => {
    setShowRulefileModal(false);
  }, []);

  const handleEquipChange = useCallback((rulefileIds: string[]) => {
    if (!selectedEntity || selectedEntity.category !== 'agent') return;

    const equippedRulefiles: EquippedRulefile[] = rulefileIds.map(id => ({
      rulefileId: id,
      enabled: true,
    }));

    updateEntity(selectedEntity.id, { equippedRulefiles });
  }, [selectedEntity, updateEntity]);

  // No hex selected
  if (!selectedHexKey) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-4xl mb-2 opacity-30">+</div>
          <p className="text-text-muted text-sm">
            Click a hex to select it
          </p>
        </div>
      </div>
    );
  }

  // Hex selected but no entity - show entity selector
  if (!selectedEntity) {
    return <EntitySelector hexKey={selectedHexKey} />;
  }

  // Entity selected - show details
  return (
    <>
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <EntityDetails
          entity={selectedEntity}
          hexKey={selectedHexKey}
          onOpenRulefileModal={selectedEntity.category === 'agent' ? handleOpenRulefileModal : undefined}
        />
      </div>

      {/* Rulefile Modal */}
      {showRulefileModal && selectedEntity.category === 'agent' && (
        <RulefileModal
          agent={selectedEntity as AgentEntity}
          onClose={handleCloseRulefileModal}
          onEquipChange={handleEquipChange}
        />
      )}
    </>
  );
}

export default Panel;

