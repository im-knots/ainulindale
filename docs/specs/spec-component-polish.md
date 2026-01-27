# Stream B: Component Polish

## Overview
Update all UI components to use the new design token system and implement consistent interaction states, typography, and visual patterns.

## Deliverables

### 1. ResourceBar Component
**File:** `frontend/src/ui/components/ResourceBar.ts`

**Current State:** Basic display of budget/tokens
**Target State:** Polished metrics display with trends

**Changes:**
- Use new typography scale (Display for values, Caption for labels)
- Add trend indicators (▲/▼ with green/red coloring)
- Add subtle progress bars for budget utilization
- Implement warning states when resources low (<20%)
- Add smooth number transitions when values change

**Visual Pattern:**
```
┌─────────────────────────────────────┐
│ 💵 $423.50                    ▼ 8%  │
│    Budget: $500 ████████░░ 85%      │
│    $12.30/hr burn rate              │
└─────────────────────────────────────┘
```

### 2. Panel Component
**File:** `frontend/src/ui/components/Panel.ts`

**Changes:**
- Implement card system with proper header/body/footer sections
- Add collapse/expand animation
- Use consistent padding (16px)
- Add subtle border and shadow
- Implement scroll behavior for long content

**Structure:**
```html
<div class="panel">
  <div class="panel-header">
    <h2>Title</h2>
    <button class="panel-close">×</button>
  </div>
  <div class="panel-body">
    <!-- Content -->
  </div>
  <div class="panel-footer">
    <!-- Actions -->
  </div>
</div>
```

### 3. CategorySelector Component
**File:** `frontend/src/ui/components/CategorySelector.ts`

**Changes:**
- Implement all interaction states (hover, active, selected, disabled)
- Add entity color accent to each button
- Improve icon/text alignment
- Add keyboard navigation support
- Subtle slide-in animation on mount

**Button States:**
```css
.category-btn {
  transition: all var(--timing-quick) var(--ease-out);
}
.category-btn:hover {
  background: var(--bg-surface);
  transform: translateX(4px);
}
.category-btn:active {
  transform: translateX(2px);
}
.category-btn.selected {
  border-left: 3px solid var(--entity-color);
  background: var(--bg-surface);
}
```

### 4. EntityDetails Component
**File:** `frontend/src/ui/components/EntityDetails.ts`

**Changes:**
- Use data visualization patterns for metrics
- Add mini sparklines for historical data (placeholder for now)
- Consistent field styling (label above, value below)
- Status badge with appropriate state color
- Cost breakdown visualization

**Field Pattern:**
```html
<div class="field">
  <label class="field-label">Model</label>
  <span class="field-value">GPT-4</span>
</div>
```

### 5. TemplateSelector Component
**File:** `frontend/src/ui/components/TemplateSelector.ts`

**Changes:**
- Grid layout for template cards
- Template preview with cost indicator
- Hover state shows full description
- Selected state with checkmark
- Category color accent

## New CSS Classes Required

```css
/* Panel System */
.panel { /* ... */ }
.panel-header { /* ... */ }
.panel-body { /* ... */ }
.panel-footer { /* ... */ }

/* Metrics Display */
.metric { /* ... */ }
.metric-value { /* ... */ }
.metric-label { /* ... */ }
.metric-trend { /* ... */ }
.metric-trend.up { color: var(--state-healthy); }
.metric-trend.down { color: var(--state-error); }

/* Progress Bars */
.progress { /* ... */ }
.progress-bar { /* ... */ }
.progress-bar.warning { /* ... */ }
.progress-bar.critical { /* ... */ }

/* Fields */
.field { /* ... */ }
.field-label { /* ... */ }
.field-value { /* ... */ }

/* Status Badges */
.badge { /* ... */ }
.badge-idle { /* ... */ }
.badge-active { /* ... */ }
.badge-warning { /* ... */ }
.badge-error { /* ... */ }
```

## Acceptance Criteria
- [ ] All components use CSS custom properties from tokens
- [ ] Consistent typography across all components
- [ ] All interactive elements have hover/active/focus states
- [ ] Smooth transitions on state changes
- [ ] Components are visually cohesive
- [ ] Build passes with no errors

## Dependencies
- Stream A (Core Style System) must be complete

## Estimated Effort
Medium - 2-3 focused sessions

