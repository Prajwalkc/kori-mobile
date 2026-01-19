import { colors } from './colors';
import { shadows } from './shadows';
import { borderRadius, spacing } from './spacing';
import { fontSizes, fontWeights, letterSpacing, lineHeights, typography } from './typography';

export { colors } from './colors';
export type { Colors } from './colors';

export { fontSizes, fontWeights, letterSpacing, lineHeights, typography } from './typography';
export type { Typography } from './typography';

export { borderRadius, spacing } from './spacing';
export type { BorderRadius, Spacing } from './spacing';

export { shadows } from './shadows';
export type { Shadows } from './shadows';

// Complete theme object
export const theme = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  fontSizes,
  fontWeights,
  lineHeights,
  letterSpacing,
} as const;

export type Theme = typeof theme;

// Default export
export default theme;
