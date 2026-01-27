# Stream C: 3D Visual System

## Overview
Enhance the Three.js rendering to implement the visual language in 3D space. Focus on glow/emission, shadows, particle effects, and selection feedback.

## Deliverables

### 1. Entity Glow System
**File:** `frontend/src/hex/renderer3d.ts`

**Current State:** Static entity colors
**Target State:** Dynamic glow based on entity state

**Implementation:**
```typescript
// Add to entity model creation
private getEntityEmissiveIntensity(entity: Entity, state: AppState): number {
  if (state.swarmStatus !== 'running') return 0.1; // Dim when stopped
  
  switch (entity.status) {
    case 'idle': return 0.2;
    case 'active': return 0.5;
    case 'error': return 0.8;
    default: return 0.2;
  }
}

// Update material in render loop
material.emissiveIntensity = this.getEntityEmissiveIntensity(entity, state);
```

**Glow Colors by State:**
| State | Emissive Color | Intensity |
|-------|---------------|-----------|
| Idle | Entity base color | 0.2 |
| Active | Entity base color | 0.5 |
| Warning | Amber (#f59e0b) | 0.7 |
| Error | Red (#ef4444) | 0.8 |

### 2. Breathing Animation
**File:** `frontend/src/hex/renderer3d.ts`

Add subtle "breathing" animation to active entities:

```typescript
private updateEntityBreathing(deltaTime: number): void {
  const time = performance.now() / 1000;
  
  this.entityModels.forEach((model, entityId) => {
    const entity = this.store.getState().entities.get(entityId);
    if (!entity) return;
    
    // Determine breath speed based on state
    let breathSpeed = 0;
    if (entity.status === 'active') breathSpeed = 0.5; // 2s cycle
    if (entity.status === 'error') breathSpeed = 2.0;  // 0.5s cycle
    
    if (breathSpeed > 0) {
      const breathe = Math.sin(time * breathSpeed * Math.PI * 2) * 0.5 + 0.5;
      const baseIntensity = this.getEntityEmissiveIntensity(entity);
      
      model.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          child.material.emissiveIntensity = baseIntensity * (0.7 + 0.3 * breathe);
        }
      });
    }
  });
}
```

### 3. Height-Based Shadows
**File:** `frontend/src/hex/renderer3d.ts`

Entities cast shadows proportional to their height (cost):

```typescript
// In entity model creation
model.traverse((child) => {
  if (child instanceof THREE.Mesh) {
    child.castShadow = true;
    child.receiveShadow = true;
  }
});

// Ensure hex surfaces receive shadows
hexMesh.receiveShadow = true;
```

**Shadow Configuration:**
- Shadow map size: 2048x2048
- Shadow bias: -0.0001 (prevent acne)
- Shadow radius: 4 (soft shadows)

### 4. Selection Lift Animation
**File:** `frontend/src/hex/renderer3d.ts`

When an entity is selected, it lifts slightly:

```typescript
private updateSelectionAnimation(deltaTime: number): void {
  const selectedHex = this.store.getState().selectedHex;
  
  this.entityModels.forEach((model, key) => {
    const targetY = key === selectedHex ? 5 : 0; // Lift 5 units
    const currentOffset = model.userData.selectionOffset || 0;
    
    // Smooth interpolation
    const newOffset = currentOffset + (targetY - currentOffset) * deltaTime * 10;
    model.userData.selectionOffset = newOffset;
    
    model.position.y = model.userData.baseY + newOffset;
  });
}
```

### 5. Flow Particle Polish
**File:** `frontend/src/hex/renderer3d.ts`

Enhance existing flow particles:

**Particle Properties by Throughput:**
| Throughput | Speed (t/s) | Count | Size | Trail |
|------------|-------------|-------|------|-------|
| Low | 0.2 | 2 | 2 | None |
| Normal | 0.4 | 4 | 2.5 | Slight |
| High | 0.8 | 6 | 3 | Yes |
| Stalled | 0 | - | - | Frozen |

**Trail Effect (optional):**
```typescript
// Create trail using line segments behind particle
const trailGeometry = new THREE.BufferGeometry();
const trailMaterial = new THREE.LineBasicMaterial({
  color: particleColor,
  transparent: true,
  opacity: 0.5,
});
```

### 6. Hex State Visualization
**File:** `frontend/src/hex/renderer3d.ts`

Hex surfaces reflect the state of their entity:

```typescript
private getHexColor(hex: HexData, state: AppState): number {
  if (!hex.entityId) return 0x1a1a2e; // Empty hex
  
  const entity = state.entities.get(hex.entityId);
  if (!entity) return 0x1a1a2e;
  
  // Tint hex surface based on entity state
  switch (entity.status) {
    case 'error': return 0x3f1a1a; // Dark red tint
    case 'active': return 0x1a2e1a; // Dark green tint
    default: return 0x1a1a2e; // Neutral
  }
}
```

## New Private Methods Required

```typescript
private getEntityEmissiveIntensity(entity: Entity, state: AppState): number;
private updateEntityBreathing(deltaTime: number): void;
private updateSelectionAnimation(deltaTime: number): void;
private getHexColor(hex: HexData, state: AppState): number;
```

## Animation Loop Updates

```typescript
private animate = (): void => {
  requestAnimationFrame(this.animate);
  
  const now = performance.now() / 1000;
  const deltaTime = this.lastTime > 0 ? now - this.lastTime : 0;
  this.lastTime = now;

  const isRunning = this.store.getState().swarmStatus === 'running';
  
  // Update all animations
  this.updateFlowParticles(deltaTime, isRunning);
  this.updateEntityBreathing(deltaTime);
  this.updateSelectionAnimation(deltaTime);

  this.controls.update();
  this.renderer.render(this.scene, this.camera);
};
```

## Acceptance Criteria
- [ ] Entities glow based on their status
- [ ] Active entities have breathing animation
- [ ] Entities cast proportional shadows
- [ ] Selected entities lift smoothly
- [ ] Flow particles match throughput state
- [ ] Hex surfaces tint based on entity state
- [ ] All animations are smooth (60fps)
- [ ] Build passes with no errors

## Dependencies
- Stream A (Core Style System) for color constants

## Estimated Effort
Medium-Large - 3-4 focused sessions

