/**
 * Horizon UI Design Tokens — Mobile-first, dark-mode glassmorphic design system
 *
 * Typography-obsessed. Word people.
 */

// ── Color Palette ───────────────────────────────────────────────────

export const colors = {
  // Base
  bg: {
    primary: 'hsl(225, 25%, 8%)', // Deep navy-black
    secondary: 'hsl(225, 20%, 12%)', // Elevated surface
    tertiary: 'hsl(225, 18%, 16%)', // Card/panel surface
    glass: 'hsla(225, 25%, 15%, 0.72)', // Glassmorphic surface
  },

  // Text
  text: {
    primary: 'hsl(210, 40%, 96%)', // Almost white with warm tint
    secondary: 'hsl(215, 20%, 68%)', // Muted text
    tertiary: 'hsl(220, 15%, 48%)', // Disabled/hint text
    inverse: 'hsl(225, 25%, 8%)', // For light backgrounds
  },

  // Accent
  accent: {
    primary: 'hsl(264, 80%, 64%)', // Electric violet
    secondary: 'hsl(200, 90%, 58%)', // Bright cyan
    tertiary: 'hsl(340, 82%, 62%)', // Warm pink
    gradient: 'linear-gradient(135deg, hsl(264, 80%, 64%), hsl(200, 90%, 58%))',
  },

  // Semantic
  semantic: {
    success: 'hsl(152, 68%, 50%)',
    warning: 'hsl(38, 92%, 58%)',
    error: 'hsl(0, 72%, 58%)',
    info: 'hsl(200, 90%, 58%)',
  },

  // Entity highlight colors
  entity: {
    person: 'hsla(200, 90%, 58%, 0.2)',
    organization: 'hsla(264, 80%, 64%, 0.2)',
    location: 'hsla(152, 68%, 50%, 0.2)',
    date: 'hsla(38, 92%, 58%, 0.2)',
    event: 'hsla(340, 82%, 62%, 0.2)',
    concept: 'hsla(180, 60%, 50%, 0.2)',
  },

  // Border
  border: {
    subtle: 'hsla(215, 20%, 68%, 0.08)',
    default: 'hsla(215, 20%, 68%, 0.15)',
    strong: 'hsla(215, 20%, 68%, 0.25)',
    focus: 'hsl(264, 80%, 64%)',
  },
} as const;

// ── Typography ──────────────────────────────────────────────────────

/** Google Fonts to preload */
export const fontFamilies = {
  /** Body text — optimized for long-form reading */
  body: '"Source Serif 4", "Georgia", serif',
  /** Headings — modern, geometric */
  heading: '"Inter", "Helvetica Neue", sans-serif',
  /** Code — ligature-rich mono */
  code: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
  /** UI chrome — clean sans */
  ui: '"Inter", -apple-system, "Segoe UI", sans-serif',
} as const;

/** Type scale — fluid, based on system of 1.25 (major third) */
export const typeScale = {
  xs: '0.75rem', // 12px
  sm: '0.875rem', // 14px
  base: '1rem', // 16px
  md: '1.125rem', // 18px — body text in editor
  lg: '1.25rem', // 20px — h4
  xl: '1.5rem', // 24px — h3
  '2xl': '1.875rem', // 30px — h2
  '3xl': '2.25rem', // 36px — h1
  '4xl': '3rem', // 48px — display
} as const;

/** Line heights — optimized for readability */
export const lineHeights = {
  tight: '1.25', // Headings
  snug: '1.375', // Sub-headings
  body: '1.7', // Body text — generous for reading
  relaxed: '1.8', // Blockquotes
} as const;

/** Letter spacing curves — tighter for large, looser for small */
export const letterSpacing = {
  tight: '-0.025em', // Display/h1
  snug: '-0.015em', // h2/h3
  normal: '0', // Body
  wide: '0.025em', // Small caps, labels
  wider: '0.05em', // All caps
} as const;

/** Maximum line length for readability (65-75 characters) */
export const measure = {
  narrow: '55ch',
  body: '68ch', // Optimal
  wide: '80ch',
} as const;

// ── Spacing ─────────────────────────────────────────────────────────

export const spacing = {
  0: '0',
  px: '1px',
  0.5: '0.125rem', // 2px
  1: '0.25rem', // 4px
  1.5: '0.375rem', // 6px
  2: '0.5rem', // 8px
  3: '0.75rem', // 12px
  4: '1rem', // 16px
  5: '1.25rem', // 20px
  6: '1.5rem', // 24px
  8: '2rem', // 32px
  10: '2.5rem', // 40px
  12: '3rem', // 48px
  16: '4rem', // 64px
} as const;

// ── Radii ───────────────────────────────────────────────────────────

export const radii = {
  none: '0',
  sm: '0.375rem', // 6px
  md: '0.5rem', // 8px
  lg: '0.75rem', // 12px
  xl: '1rem', // 16px
  full: '9999px',
} as const;

// ── Shadows ─────────────────────────────────────────────────────────

export const shadows = {
  sm: '0 1px 2px hsla(0, 0%, 0%, 0.3)',
  md: '0 4px 12px hsla(0, 0%, 0%, 0.3)',
  lg: '0 8px 30px hsla(0, 0%, 0%, 0.4)',
  xl: '0 16px 48px hsla(0, 0%, 0%, 0.5)',
  glow: '0 0 20px hsla(264, 80%, 64%, 0.3)',
  inner: 'inset 0 1px 3px hsla(0, 0%, 0%, 0.2)',
} as const;

// ── Glass Effect ────────────────────────────────────────────────────

export const glass = {
  blur: '16px',
  saturate: '1.2',
  border: '1px solid hsla(215, 20%, 68%, 0.08)',
  background: colors.bg.glass,
} as const;

// ── Motion ──────────────────────────────────────────────────────────

export const motion = {
  fast: '100ms',
  normal: '200ms',
  slow: '350ms',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
} as const;

// ── Breakpoints (mobile-first) ──────────────────────────────────────

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;

// ── Z-Index ─────────────────────────────────────────────────────────

export const zIndex = {
  base: 0,
  toolbar: 10,
  menu: 20,
  overlay: 30,
  modal: 40,
  tooltip: 50,
} as const;

// ── OpenType Feature Settings ───────────────────────────────────────

export const openTypeFeatures = {
  /** Standard ligatures */
  ligatures: '"liga" 1, "calt" 1',
  /** Old-style numerals for body text */
  bodyNumerals: '"onum" 1, "pnum" 1',
  /** Tabular lining numerals for tables/data */
  tableNumerals: '"lnum" 1, "tnum" 1',
  /** Small caps */
  smallCaps: '"smcp" 1',
  /** Swashes */
  swash: '"swsh" 1',
  /** Fractions */
  fractions: '"frac" 1',
} as const;
