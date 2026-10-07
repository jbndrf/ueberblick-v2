import type { ThemeName } from '@ueberblick/core/registry';
import type { ThemeTokens, ColorPair } from './contract';

/** Touch target sizes in px (docs/13 principle 9). Same in every theme. */
export const TARGET_SIZE = { primary: 56, other: 44 } as const;

const shared = {
  space: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
  radius: { sm: '6px', md: '12px', lg: '20px', pill: '999px' },
  type: {
    family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    sizeSm: '0.875rem',
    sizeMd: '1rem',
    sizeLg: '1.25rem',
    weightNormal: '400',
    weightStrong: '600',
    lineHeight: '1.5',
  },
} as const;

/** Default theme: WCAG 2.2 AA. */
export const NORMAL_THEME: ThemeTokens = {
  name: 'normal',
  ...shared,
  elevation: { raised: '0 1px 3px rgba(0,0,0,.2)', overlay: '0 8px 24px rgba(0,0,0,.28)' },
  color: {
    bg: '#ffffff',
    surface: '#f3f6f4',
    text: '#1a1f1c',
    textMuted: '#4a544d',
    border: '#6b756e',
    focus: '#0b57d0',
    primary: '#1b5e3b',
    onPrimary: '#ffffff',
    danger: '#b3261e',
    onDanger: '#ffffff',
    scrim: 'rgba(0,0,0,.5)',
    statusOnline: { fg: '#14532d', bg: '#dcfce7' },
    statusOffline: { fg: '#3f3f46', bg: '#e4e4e7' },
    statusPending: { fg: '#7a4100', bg: '#fff1d6' },
    statusRefused: { fg: '#8c1d18', bg: '#fde7e5' },
  },
};

/** Outdoor theme: pure black on white, at least 7:1 everywhere, thicker focus ring. */
export const OUTDOOR_THEME: ThemeTokens = {
  name: 'outdoor',
  ...shared,
  elevation: { raised: '0 0 0 2px #000', overlay: '0 0 0 3px #000' },
  color: {
    bg: '#ffffff',
    surface: '#ffffff',
    text: '#000000',
    textMuted: '#1f1f1f',
    border: '#000000',
    focus: '#0033a0',
    primary: '#0b3d24',
    onPrimary: '#ffffff',
    danger: '#7a0000',
    onDanger: '#ffffff',
    scrim: 'rgba(0,0,0,.75)',
    statusOnline: { fg: '#003d1a', bg: '#ffffff' },
    statusOffline: { fg: '#1f1f1f', bg: '#ffffff' },
    statusPending: { fg: '#5c2e00', bg: '#ffffff' },
    statusRefused: { fg: '#6b0000', bg: '#ffffff' },
  },
};

export const THEMES: Readonly<Record<ThemeName, ThemeTokens>> = {
  normal: NORMAL_THEME,
  outdoor: OUTDOOR_THEME,
};

/** Every text-on-background pair the primitives use; the contrast test walks this list. */
export function textPairs(t: ThemeTokens): readonly ColorPair[] {
  const c = t.color;
  return [
    { name: 'text on bg', fg: c.text, bg: c.bg },
    { name: 'text on surface', fg: c.text, bg: c.surface },
    { name: 'muted text on bg', fg: c.textMuted, bg: c.bg },
    { name: 'muted text on surface', fg: c.textMuted, bg: c.surface },
    { name: 'primary button', fg: c.onPrimary, bg: c.primary },
    { name: 'danger button', fg: c.onDanger, bg: c.danger },
    { name: 'secondary button label', fg: c.primary, bg: c.bg },
    { name: 'error text on bg', fg: c.danger, bg: c.bg },
    { name: 'error text on surface', fg: c.danger, bg: c.surface },
    { name: 'status online', fg: c.statusOnline.fg, bg: c.statusOnline.bg },
    { name: 'status offline', fg: c.statusOffline.fg, bg: c.statusOffline.bg },
    { name: 'status pending', fg: c.statusPending.fg, bg: c.statusPending.bg },
    { name: 'status refused', fg: c.statusRefused.fg, bg: c.statusRefused.bg },
  ];
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/** Flattens a theme to `--ub-*` custom properties. Admin theming later edits this data (principle 10). */
export function themeVars(t: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.color)) {
    if (typeof v === 'string') out[`--ub-color-${kebab(k)}`] = v;
    else {
      out[`--ub-color-${kebab(k)}-fg`] = v.fg;
      out[`--ub-color-${kebab(k)}-bg`] = v.bg;
    }
  }
  for (const [k, v] of Object.entries(t.space)) out[`--ub-space-${k}`] = v;
  for (const [k, v] of Object.entries(t.radius)) out[`--ub-radius-${k}`] = v;
  for (const [k, v] of Object.entries(t.elevation)) out[`--ub-elevation-${k}`] = v;
  for (const [k, v] of Object.entries(t.type)) out[`--ub-type-${kebab(k)}`] = v;
  out['--ub-target-primary'] = `${TARGET_SIZE.primary}px`;
  out['--ub-target-other'] = `${TARGET_SIZE.other}px`;
  return out;
}

/** CSS text: `selector { --ub-...: ...; }`. */
export function themeToCss(t: ThemeTokens, selector = ':root'): string {
  const body = Object.entries(themeVars(t))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n}\n`;
}
