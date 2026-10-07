// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isPlanted } from '../../../scripts/testing/plant.mjs';

/** WP-628: app code reaches the packages/ui axe helper and jsdom shims through `@ueberblick/ui/testing`, never by a relative deep path. */
const root = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || isPlanted(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|svelte)$/.test(name)) out.push(full);
  }
  return out;
}

describe('ui test helper imports', () => {
  it('no apps/web file deep-imports the axe helper or the jsdom shims', () => {
    const offenders = walk(root)
      .filter((f) => !f.endsWith('ui-testing-imports.spec.ts'))
      .filter((f) =>
        /['"][^'"]*packages\/ui\/src\/(testing\/|components\/ui\/jsdom-shims)[^'"]*['"]/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it('@ueberblick/ui/testing exports the axe helper and installs the jsdom shims', async () => {
    const g = globalThis as { ResizeObserver?: unknown };
    const before = g.ResizeObserver;
    delete g.ResizeObserver;
    try {
      vi.resetModules(); // the import is cached across repeats; re-run its side effect
      const mod = await import('@ueberblick/ui/testing');
      expect(typeof mod.axeViolations).toBe('function');
      expect(typeof g.ResizeObserver).toBe('function');
    } finally {
      if (before !== undefined) g.ResizeObserver = before;
    }
  });
});
