# Stream D: State Visualization

## Overview
Implement comprehensive state visualization so operators can understand system status at a glance. This includes entity states, queue depths, throughput indicators, and connection status.

## Deliverables

### 1. Entity Status System
**File:** `frontend/src/state/store.ts`

Extend entity status with more granular states:

```typescript
export type EntityStatus = 
  | 'idle'       // Not processing, waiting for work
  | 'active'     // Currently processing
  | 'busy'       // Processing at high capacity
  | 'warning'    // Elevated error rate or latency
  | 'error'      // Failed, needs attention
  | 'disabled';  // Manually turned off

export interface EntityMetrics {
  throughput: number;      // units/hour
  errorRate: number;       // 0-1
  latencyMs: number;       // average response time
  queueDepth: number;      // items waiting
  utilization: number;     // 0-1, how busy
}

// Add to BaseEntity
export interface BaseEntity {
  // ... existing fields
  metrics?: EntityMetrics;
}
```

### 2. Queue Depth Visualization at Ports
**File:** `frontend/src/hex/renderer3d.ts`

Show visual queue at input ports:

```typescript
private renderPortQueue(port: Port, state: AppState): void {
  const entity = port.entityId ? state.entities.get(port.entityId) : null;
  if (!entity || entity.category !== 'input') return;
  
  const inputEntity = entity as InputEntity;
  const queueDepth = inputEntity.queueDepth;
  
  // Create stacked boxes representing queued items
  const maxVisible = 10;
  const itemsToShow = Math.min(queueDepth, maxVisible);
  
  for (let i = 0; i < itemsToShow; i++) {
    const boxGeometry = new THREE.BoxGeometry(4, 2, 4);
    const boxMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.8 - (i * 0.05),
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.y = 12 + (i * 3); // Stack upward
    // Add to port group
  }
  
  // If queue > maxVisible, show "+N" indicator
  if (queueDepth > maxVisible) {
    // Add text sprite showing "+N"
  }
}
```

### 3. Throughput Indicators on Connections
**File:** `frontend/src/hex/renderer3d.ts`

Connection line thickness/brightness based on throughput:

```typescript
private getConnectionAppearance(conn: Connection, state: AppState): {
  thickness: number;
  opacity: number;
  particleCount: number;
} {
  // Calculate throughput for this connection
  const fromEntity = this.getEntityForConnection(conn.from, state);
  const throughput = fromEntity?.metrics?.throughput || 0;
  
  if (throughput === 0) {
    return { thickness: 1, opacity: 0.3, particleCount: 0 };
  } else if (throughput < 100) {
    return { thickness: 2, opacity: 0.5, particleCount: 2 };
  } else if (throughput < 500) {
    return { thickness: 3, opacity: 0.7, particleCount: 4 };
  } else {
    return { thickness: 4, opacity: 1.0, particleCount: 6 };
  }
}
```

### 4. Status Badges in UI
**File:** `frontend/src/ui/components/EntityDetails.ts`

Show status badge with appropriate styling:

```typescript
private renderStatusBadge(status: EntityStatus): string {
  const configs = {
    idle: { label: 'Idle', class: 'badge-idle', icon: '○' },
    active: { label: 'Active', class: 'badge-active', icon: '●' },
    busy: { label: 'Busy', class: 'badge-busy', icon: '◉' },
    warning: { label: 'Warning', class: 'badge-warning', icon: '⚠' },
    error: { label: 'Error', class: 'badge-error', icon: '✕' },
    disabled: { label: 'Disabled', class: 'badge-disabled', icon: '◌' },
  };
  
  const config = configs[status];
  return `<span class="badge ${config.class}">${config.icon} ${config.label}</span>`;
}
```

### 5. Utilization Halos
**File:** `frontend/src/hex/renderer3d.ts`

Ring around entity base showing utilization:

```typescript
private createUtilizationRing(entity: Entity): THREE.Mesh {
  const utilization = entity.metrics?.utilization || 0;
  
  // Ring geometry - filled portion based on utilization
  const geometry = new THREE.RingGeometry(
    HEX_SIZE * 0.8,  // inner radius
    HEX_SIZE * 0.9,  // outer radius
    32,              // segments
    1,               // phi segments
    0,               // start angle
    Math.PI * 2 * utilization // sweep angle
  );
  
  // Color based on utilization level
  let color = 0x22c55e; // green
  if (utilization > 0.75) color = 0xf59e0b; // amber
  if (utilization > 0.9) color = 0xef4444; // red
  
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  return ring;
}
```

### 6. Error Propagation Visualization
**File:** `frontend/src/hex/renderer3d.ts`

When an entity errors, show impact upstream:

```typescript
private visualizeErrorPropagation(errorEntityId: string, state: AppState): void {
  // Find all connections leading to this entity
  const upstreamConnections = state.connections.filter(c => c.to === errorEntityId);
  
  // Tint upstream connections red
  upstreamConnections.forEach(conn => {
    const line = this.connectionLines.getObjectByName(conn.id);
    if (line && line instanceof THREE.Line) {
      (line.material as THREE.LineBasicMaterial).color.setHex(0xef4444);
    }
  });
  
  // Show "blocked" particles frozen on the connection
  // ...
}
```

## CSS for Status Badges

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-caption);
  font-weight: 500;
}

.badge-idle {
  background: var(--bg-surface);
  color: var(--text-muted);
}

.badge-active {
  background: rgba(34, 197, 94, 0.2);
  color: var(--state-healthy);
}

.badge-busy {
  background: rgba(34, 197, 94, 0.3);
  color: var(--state-healthy);
  animation: pulse 1s ease-in-out infinite;
}

.badge-warning {
  background: rgba(245, 158, 11, 0.2);
  color: var(--state-warning);
}

.badge-error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--state-error);
  animation: pulse 0.5s ease-in-out infinite;
}

.badge-disabled {
  background: var(--bg-surface);
  color: var(--text-muted);
  opacity: 0.5;
}
```

## Acceptance Criteria
- [ ] Entity status system extended with new states
- [ ] Queue depth visualized at input ports
- [ ] Connection thickness reflects throughput
- [ ] Status badges render with correct styling
- [ ] Utilization rings show around entity bases
- [ ] Error propagation visible upstream
- [ ] All states clearly distinguishable at a glance
- [ ] Build passes with no errors

## Dependencies
- Stream A (Core Style System)
- Stream C (3D Visual System) - for integration

## Estimated Effort
Large - 4-5 focused sessions

