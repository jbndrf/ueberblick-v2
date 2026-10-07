import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { contrastRatio } from './contrast';
import { THEMES, TARGET_SIZE, textPairs, themeToCss, themeVars } from './tokens';
import { THEME_NAMES } from '@ueberblick/core/registry';

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5);
  });

  it('is symmetric and within 1..21 (property)', () => {
    const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, '0')}`);
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        const r = contrastRatio(a, b);
        expect(r).toBeCloseTo(contrastRatio(b, a), 9);
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(21.0000001);
      }),
    );
  });
});

describe('themes', () => {
  it('has one theme per registry key', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_NAMES.keys].sort());
  });

  it.each([
    ['normal', 4.5],
    ['outdoor', 7],
  ] as const)('%s: every text pair meets %s:1', (name, min) => {
    for (const p of textPairs(THEMES[name])) {
      expect(contrastRatio(p.fg, p.bg), `${name} / ${p.name}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('focus ring and border have at least 3:1 against the background (non-text, WCAG 1.4.11)', () => {
    for (const t of Object.values(THEMES)) {
      expect(contrastRatio(t.color.focus, t.color.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.color.border, t.color.bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('emits custom properties for colour, space, radius, elevation, type and targets', () => {
    const vars = themeVars(THEMES.normal);
    expect(vars['--ub-color-primary']).toBe(THEMES.normal.color.primary);
    expect(vars['--ub-color-status-online-fg']).toBe(THEMES.normal.color.statusOnline.fg);
    expect(vars['--ub-space-md']).toBeDefined();
    expect(vars['--ub-radius-md']).toBeDefined();
    expect(vars['--ub-elevation-raised']).toBeDefined();
    expect(vars['--ub-type-size-md']).toBeDefined();
    expect(vars['--ub-target-primary']).toBe('56px');
  });

  it('renders CSS text scoped to a selector', () => {
    const css = themeToCss(THEMES.outdoor, '[data-theme="outdoor"]');
    expect(css.startsWith('[data-theme="outdoor"] {')).toBe(true);
    expect(css).toContain('--ub-color-text: #000000;');
  });

  it('target sizes meet the field-proof minimums', () => {
    expect(TARGET_SIZE.primary).toBeGreaterThanOrEqual(56);
    expect(TARGET_SIZE.other).toBeGreaterThanOrEqual(44);
  });
});
