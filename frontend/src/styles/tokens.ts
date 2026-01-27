/**
 * Design Tokens for Ainulindale
 *
 * Centralized design constants ensuring visual consistency across the application.
 * These values are also mirrored as CSS custom properties in main.css.
 */

export const COLORS = {
  // Backgrounds (lightened for better visibility)
  bgPrimary: '#12121a',
  bgElevated: '#252538',
  bgSurface: '#3a3a52',

  // Hex grid specific colors
  hexEmpty: '#2a2a3a',        // Empty hex base color
  hexEmptyEmissive: '#3a3a4a', // Empty hex glow
  hexEdge: '#5a5a7a',         // Hex edge color
  
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
  
  // Entity Colors (simplified to agent + tool)
  entityAgent: '#22c55e',
  entityTool: '#06b6d4',
  // Legacy alias for backwards compatibility
  entityMcp: '#06b6d4',

  // Flow Colors
  flowInput: '#06b6d4',
  flowOutput: '#f97316',
  flowData: '#a855f7',
} as const;

// Hex color versions for Three.js (lightened for better visibility)
export const COLORS_HEX = {
  bgPrimary: 0x12121a,
  bgElevated: 0x252538,
  bgSurface: 0x3a3a52,

  // Hex grid specific colors
  hexEmpty: 0x2a2a3a,        // Empty hex base color
  hexEmptyEmissive: 0x3a3a4a, // Empty hex glow
  hexEdge: 0x5a5a7a,         // Hex edge color
  hexSelected: 0x2e2e42,     // Selected hex base
  
  stateIdle: 0x64748b,
  stateHealthy: 0x22c55e,
  stateWarning: 0xf59e0b,
  stateError: 0xef4444,
  stateInfo: 0x3b82f6,
  
  // Entity Colors (simplified to agent + tool)
  entityAgent: 0x22c55e,
  entityTool: 0x06b6d4,
  // Legacy alias for backwards compatibility
  entityMcp: 0x06b6d4,
} as const;

export const GLOW = {
  none: 0,
  subtle: 0.2,
  soft: 0.4,
  medium: 0.6,
  strong: 0.8,
  intense: 1.0,
} as const;

export const TIMING = {
  instant: 50,
  quick: 150,
  smooth: 400,
  slow: 1000,
} as const;

export const EASING = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
} as const;

export const SIZES = {
  // Border radii
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 12,
  
  // Typography (px)
  fontMicro: 10,
  fontCaption: 12,
  fontBody: 14,
  fontHeading: 18,
  fontTitle: 24,
  fontDisplay: 32,
  
  // Spacing (px)
  spacingXs: 4,
  spacingSm: 8,
  spacingMd: 16,
  spacingLg: 24,
  spacingXl: 32,
} as const;

export const ANIMATION = {
  // Breathing cycle durations (ms)
  breatheSlow: 4000,   // Idle/standby
  breatheNormal: 2000, // Active
  breatheFast: 1000,   // Busy
  pulse: 500,          // Warning/error
  
  // Flow particle speeds (units per second)
  flowSlow: 0.2,
  flowNormal: 0.4,
  flowFast: 0.8,
} as const;

// Entity status to visual properties mapping
export const STATUS_VISUALS = {
  idle: {
    glowIntensity: GLOW.subtle,
    breatheSpeed: 0,
    color: COLORS_HEX.stateIdle,
  },
  active: {
    glowIntensity: GLOW.medium,
    breatheSpeed: ANIMATION.breatheNormal,
    color: COLORS_HEX.stateHealthy,
  },
  busy: {
    glowIntensity: GLOW.strong,
    breatheSpeed: ANIMATION.breatheFast,
    color: COLORS_HEX.stateHealthy,
  },
  warning: {
    glowIntensity: GLOW.strong,
    breatheSpeed: ANIMATION.pulse,
    color: COLORS_HEX.stateWarning,
  },
  error: {
    glowIntensity: GLOW.intense,
    breatheSpeed: ANIMATION.pulse,
    color: COLORS_HEX.stateError,
  },
  disabled: {
    glowIntensity: GLOW.none,
    breatheSpeed: 0,
    color: COLORS_HEX.stateIdle,
  },
} as const;

