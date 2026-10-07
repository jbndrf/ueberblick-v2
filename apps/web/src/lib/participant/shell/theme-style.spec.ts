import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@ueberblick/ui';
import { isPlanted } from '../../../../../../scripts/testing/plant.mjs';
import { applyThemeTokens } from './theme-style';

function fakeRoot(): { props: Map<string, string>; style: { setProperty(n: string, v: string): void } } {
  const props = new Map<string, string>();
  return { props, style: { setProperty: (n, v) => void props.set(n, v) } };
}

describe('applyThemeTokens (WP-714)', () => {
  it('sets the theme tokens on the root, and a switch to outdoor replaces them at once', () => {
    const root = fakeRoot();
    applyThemeTokens(root, 'normal');
    expect(root.props.get('--ub-color-text')).toBe(THEMES.normal.color.text);
    applyThemeTokens(root, 'outdoor');
    expect(root.props.get('--ub-color-text')).toBe(THEMES.outdoor.color.text);
    expect(root.props.get('--ub-color-text')).not.toBe(THEMES.normal.color.text);
    applyThemeTokens(root, 'outdoor')(); // the undo: back to normal
    expect(root.props.get('--ub-color-text')).toBe(THEMES.normal.color.text);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (isPlanted(f)) return [];
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|svelte)$/.test(f) && !f.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('one place sets the --ub-* tokens of the participant app (R1)', () => {
  it('only theme-style.ts reads themeVars or writes a --ub- property', () => {
    const src = join(__dirname, '..', '..', '..');
    const hits = sources(src)
      .filter((p) =>
        /themeVars|themeToCss|setProperty\(\s*['"`]--ub-(color|space|radius)/.test(readFileSync(p, 'utf8')),
      )
      .map((p) => p.slice(src.length + 1));
    expect(hits).toEqual(['lib/participant/shell/theme-style.ts']);
  });
});
