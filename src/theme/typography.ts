import { TextStyle } from 'react-native';

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const fontSizes = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 22,
  '3xl': 24,
  '4xl': 28,
  '5xl': 36,
  '6xl': 48,
} as const;

export const lineHeights = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.75,
  loose: 2,
} as const;

export const letterSpacing = {
  tight: -0.5,
  normal: 0,
  wide: 1,
  wider: 2,
  widest: 4,
} as const;

// Pre-defined text styles
export const typography = {
  // Headings
  h1: {
    fontSize: fontSizes['4xl'],
    fontWeight: fontWeights.bold,
    lineHeight: fontSizes['4xl'] * lineHeights.tight,
  } as TextStyle,

  h2: {
    fontSize: fontSizes['3xl'],
    fontWeight: fontWeights.bold,
    lineHeight: fontSizes['3xl'] * lineHeights.tight,
  } as TextStyle,

  h3: {
    fontSize: fontSizes['2xl'],
    fontWeight: fontWeights.semibold,
    lineHeight: fontSizes['2xl'] * lineHeights.normal,
  } as TextStyle,

  h4: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.semibold,
    lineHeight: fontSizes.xl * lineHeights.normal,
  } as TextStyle,

  h5: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.medium,
    lineHeight: fontSizes.lg * lineHeights.normal,
  } as TextStyle,

  // Body text
  body: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.regular,
    lineHeight: fontSizes.base * lineHeights.normal,
  } as TextStyle,

  bodyLarge: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.regular,
    lineHeight: fontSizes.lg * lineHeights.normal,
  } as TextStyle,

  bodySmall: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.regular,
    lineHeight: fontSizes.sm * lineHeights.normal,
  } as TextStyle,

  // Special text styles
  caption: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.regular,
    lineHeight: fontSizes.xs * lineHeights.normal,
  } as TextStyle,

  button: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.regular,
    lineHeight: fontSizes.lg * lineHeights.tight,
  } as TextStyle,

  logo: {
    fontSize: fontSizes['5xl'],
    fontWeight: fontWeights.bold,
    letterSpacing: letterSpacing.widest,
  } as TextStyle,

  timer: {
    fontSize: fontSizes['6xl'],
    fontWeight: fontWeights.bold,
    lineHeight: fontSizes['6xl'] * lineHeights.tight,
  } as TextStyle,
} as const;

export type Typography = typeof typography;
