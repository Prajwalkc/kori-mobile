export const colors = {
  // Primary colors
  primary: '#5DBBDB',
  primaryDark: '#4A9AB5',
  primaryLight: '#7DCDE8',

  // Background colors
  background: {
    primary: '#0F1B2E',
    secondary: '#1A2A3F',
    elevated: 'rgba(255, 255, 255, 0.05)',
  },

  // Text colors
  text: {
    primary: '#FFFFFF',
    secondary: 'rgba(255, 255, 255, 0.6)',
    tertiary: 'rgba(255, 255, 255, 0.4)',
    disabled: 'rgba(255, 255, 255, 0.3)',
  },

  // Border colors
  border: {
    primary: 'rgba(255, 255, 255, 0.2)',
    secondary: 'rgba(255, 255, 255, 0.3)',
    focus: 'rgba(93, 187, 219, 0.5)',
  },

  // Status colors
  status: {
    success: '#FFFFFF',
    error: '#FFFFFF',
    warning: '#FFFFFF',
    info: '#FFFFFF',
  },

  // Overlay colors
  overlay: {
    light: 'rgba(0, 0, 0, 0.3)',
    medium: 'rgba(0, 0, 0, 0.5)',
    dark: 'rgba(0, 0, 0, 0.7)',
  },

  // Transparent
  transparent: 'transparent',
} as const;

export type Colors = typeof colors;
