# Stream A: Core Style System

## Overview
Create a centralized design token system that defines all colors, sizes, timing, and visual constants used throughout Ainulindale. This ensures consistency and makes future updates trivial.

## Deliverables

### 1. Design Tokens File
**File:** `frontend/src/styles/tokens.ts`

```typescript
export const COLORS = {
  // Backgrounds
  bgPrimary: '#0a0a0f',
  bgElevated: '#1a1a2e',
  bgSurface: '#2d2d44',
  
  // Text
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  
  // Semantic States
  stateIdle: '#64748b',
  stateHealthy: '#22c55e',
  stateWarning: '#f59e0b',
  stateError: '#ef4444',
  stateInfo: '#3b82f6',
  
  // Entity Colors
  entityAgent: '#22c55e',
  entityMcp: '#06b6d4',
  entityRag: '#a855f7',
  entityExecutor: '#f59e0b',
  entityDatastore: '#64748b',
  entityInput: '#3b82f6',
  entityOutput: '#f97316',
  
  // Flow
  flowInput: '#06b6d4',
  flowOutput: '#f97316',
  flowData: '#a855f7',
};

export const GLOW = {
  none: 0,
  subtle: 0.3,
  soft: 0.5,
  medium: 0.7,
  strong: 1.0,
};

export const TIMING = {
  instant: 50,
  quick: 150,
  smooth: 400,
  slow: 1000,
};

export const EASING = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
};

export const SIZES = {
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 12,
  
  fontMicro: 10,
  fontCaption: 12,
  fontBody: 14,
  fontHeading: 18,
  fontTitle: 24,
  fontDisplay: 32,
};

export const ANIMATION = {
  breatheSlow: 4000,  // ms - idle/standby
  breatheNormal: 2000, // ms - active
  breatheFast: 1000,   // ms - busy
  pulse: 500,          // ms - warning/error
};
```

### 2. CSS Custom Properties
**File:** Update `frontend/src/styles/main.css`

Add at the top of the file:
```css
:root {
  /* Backgrounds */
  --bg-primary: #0a0a0f;
  --bg-elevated: #1a1a2e;
  --bg-surface: #2d2d44;
  
  /* Text */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  
  /* States */
  --state-idle: #64748b;
  --state-healthy: #22c55e;
  --state-warning: #f59e0b;
  --state-error: #ef4444;
  --state-info: #3b82f6;
  
  /* Timing */
  --timing-instant: 50ms;
  --timing-quick: 150ms;
  --timing-smooth: 400ms;
  --timing-slow: 1000ms;
  
  /* Easing */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  
  /* Radii */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.5);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.5);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.5);
}
```

### 3. Utility Classes
Add to `main.css`:
```css
/* Glow utilities */
.glow-none { box-shadow: none; }
.glow-subtle { box-shadow: 0 0 10px currentColor; opacity: 0.3; }
.glow-soft { box-shadow: 0 0 15px currentColor; opacity: 0.5; }
.glow-medium { box-shadow: 0 0 20px currentColor; opacity: 0.7; }
.glow-strong { box-shadow: 0 0 30px currentColor; opacity: 1; }

/* State colors */
.state-idle { color: var(--state-idle); }
.state-healthy { color: var(--state-healthy); }
.state-warning { color: var(--state-warning); }
.state-error { color: var(--state-error); }

/* Animation utilities */
@keyframes breathe {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}
.animate-breathe-slow { animation: breathe 4s ease-in-out infinite; }
.animate-breathe { animation: breathe 2s ease-in-out infinite; }
.animate-breathe-fast { animation: breathe 1s ease-in-out infinite; }
.animate-pulse { animation: pulse 0.5s ease-in-out infinite; }
```

## Acceptance Criteria
- [ ] `tokens.ts` exports all design constants
- [ ] CSS custom properties defined in `:root`
- [ ] Utility classes for common patterns
- [ ] Existing components still render correctly
- [ ] Build passes with no errors

## Dependencies
None - this is foundational work.

## Estimated Effort
Small - 1 focused session

