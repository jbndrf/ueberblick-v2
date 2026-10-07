import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';
import { DETAIL, LAYER } from './layers';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SHELL_ROUTES = fileURLToPath(new URL('../../routes/(participant)', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (isPlanted(name)) return [];
    if (statSync(path).isDirectory()) return name === 'e2e' || name === 'paraglide' ? [] : sources(path);
    return /\.(svelte|ts)$/.test(name) && !/\.(spec|e2e|testing)\./.test(name) ? [path] : [];
  });
}

describe('the participant layer order (WP-709)', () => {
  it('no overlay of the shell carries its own z-[NNNN]: they come from layers.ts', () => {
    const own = [...sources(HERE), ...sources(SHELL_ROUTES)].filter((f) => !f.endsWith('/layers.ts'));
    const offenders = own.filter((f) => /\bz-\[\d+\]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the detail panel (ModuleShell) is the plane layers.ts assumes', () => {
    const shell = readFileSync(
      fileURLToPath(
        new URL('../../../../../packages/ui/src/components/module-shell/ModuleShell.svelte', import.meta.url),
      ),
      'utf8',
    );
    expect(shell).toContain(`z-[${DETAIL}]`);
  });

  it('stacks bottom to top as v3 did, with Zuletzt over the picker backdrop', () => {
    const n = (c: string): number => Number(/(\d+)\]?$/.exec(c)?.[1]);
    expect(n(LAYER.pickerBackdrop)).toBeLessThan(n(LAYER.recent));
    expect(n(LAYER.recent)).toBeLessThan(n(LAYER.bar));
    expect(n(LAYER.bar)).toBeLessThan(n(LAYER.pill));
    expect(n(LAYER.pill)).toBeLessThan(DETAIL);
    expect(DETAIL).toBeLessThan(n(LAYER.recentBesideDetail));
    expect(n(LAYER.recentBesideDetail)).toBeLessThan(n(LAYER.panel));
    // v3 stacks Einstellungen over an open form: on a phone as well (WP-829), so the panel layer is not desktop-only.
    expect(LAYER.panel).not.toContain('md:');
    expect(n(LAYER.panel)).toBeLessThan(n(LAYER.menu));
    expect(n(LAYER.menu)).toBeLessThan(n(LAYER.top));
  });
});
