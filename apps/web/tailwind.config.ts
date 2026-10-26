import type { Config } from 'tailwindcss';

/**
 * Colours point at CSS variables defined in src/styles/tokens.css (generated from
 * docs/design/tokens.json, light + dark), so dark mode only swaps variables.
 * Use logical utilities (ms-*, me-*, ps-*, pe-*, start-*, end-*) instead of left/right.
 */
const color = (name: string) => `var(--color-${name})`;
const names = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'text',
  'text-muted',
  'primary',
  'primary-hover',
  'primary-soft',
  'on-primary',
  'accent',
  'accent-soft',
  'match',
  'match-soft',
  'near',
  'near-soft',
  'danger',
  'danger-soft',
  'info',
  'info-soft',
  'focus',
];

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: Object.fromEntries(names.map((n) => [n, color(n)])),
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', 'system-ui', '-apple-system', '"Segoe UI"', 'Tahoma', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['14px', { lineHeight: '1.6' }],
        base: ['16px', { lineHeight: '1.7' }],
        lg: ['18px', { lineHeight: '1.6' }],
        xl: ['20px', { lineHeight: '1.4' }],
        '2xl': ['24px', { lineHeight: '1.35' }],
        '3xl': ['30px', { lineHeight: '1.3' }],
        '4xl': ['36px', { lineHeight: '1.25' }],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '20px', pill: '999px' },
      boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)' },
      maxWidth: { container: '1120px', form: '640px' },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
      outlineColor: { focus: color('focus') },
    },
  },
  plugins: [],
};

export default config;
