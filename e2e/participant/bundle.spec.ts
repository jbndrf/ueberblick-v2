import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { isPlanted } from '../../scripts/testing/plant.mjs';

/**
 * R14 / docs/12 "Participant shell JS (initial, gzipped) <= 250 KB": what the browser must load before the participant
 * app draws is the static-import closure of the route's entry (SvelteKit's start and app entries, the root and group
 * layouts and the page). Core geo (JSTS, proj4), MapLibre, the tools and the builder must be lazy chunks outside it.
 * Needs the build: `npm run build -w @ueberblick/web`.
 */
const CLIENT = fileURLToPath(new URL('../../apps/web/.svelte-kit/output/client', import.meta.url));
const APP_JS = fileURLToPath(
  new URL('../../apps/web/.svelte-kit/generated/client-optimized/app.js', import.meta.url),
);
const BUDGET_KB = 250;

interface Entry {
  readonly file: string;
  readonly css?: readonly string[];
  readonly imports?: readonly string[];
}
const manifest = (): Record<string, Entry> =>
  JSON.parse(readFileSync(join(CLIENT, '.vite/manifest.json'), 'utf8')) as Record<string, Entry>;

/** The nodes of a route in `app.js`: the root layout, the group layouts and the page. */
function nodesOf(route: string): number[] {
  const dictionary =
    /export const dictionary = \{([\s\S]*?)\n\t\};?/.exec(readFileSync(APP_JS, 'utf8'))?.[1] ?? '';
  const line = dictionary.split('\n').find((l) => l.includes(`"${route}"`));
  if (line === undefined) throw new Error(`route ${route} is not in the app`);
  return [0, ...(line.match(/\d+/g) ?? []).map(Number)];
}

function closure(m: Record<string, Entry>, keys: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...keys];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (seen.has(key) || m[key] === undefined) continue;
    seen.add(key);
    stack.push(...(m[key].imports ?? []));
  }
  return seen;
}

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    isPlanted(d.name)
      ? []
      : d.isDirectory()
        ? jsFiles(join(dir, d.name))
        : d.name.endsWith('.js')
          ? [join(dir, d.name)]
          : [],
  );
}

test.describe('participant route bundle', () => {
  test.skip(!existsSync(join(CLIENT, '.vite/manifest.json')), 'build apps/web first');

  const m = existsSync(join(CLIENT, '.vite/manifest.json')) ? manifest() : {};
  const entryKeys = (): string[] => {
    const keys = Object.keys(m);
    const start = keys.find((k) => k.endsWith('sveltekit/src/runtime/client/entry.js'));
    const app = keys.find((k) => k.endsWith('client-optimized/app.js'));
    const nodes = nodesOf('/(participant)/map').map(
      (n) => `.svelte-kit/generated/client-optimized/nodes/${n}.js`,
    );
    return [start, app, ...nodes].filter((k): k is string => k !== undefined);
  };

  test('the shell chunks of /map fit the budget', () => {
    const files = [...closure(m, entryKeys())].map((k) => (m[k] as Entry).file);
    const gzipKb = files.reduce((sum, f) => sum + gzipSync(readFileSync(join(CLIENT, f))).length, 0) / 1024;
    console.log(
      `participant shell: ${files.length} files, ${gzipKb.toFixed(1)} KB gzip (budget ${BUDGET_KB})`,
    );
    expect(gzipKb).toBeLessThanOrEqual(BUDGET_KB);
  });

  // A marker is a string only that library contains; it must exist in the build (or the check proves nothing)
  // and must not be in the shell closure.
  const MARKERS = [
    ['core geo (JSTS)', 'TopologyException'],
    ['core geo (proj4)', '+proj='],
    ['MapLibre', 'maplibre-gl-font-face'],
    ['the builder (zod)', 'ZodError'],
  ] as const;

  for (const [name, marker] of MARKERS)
    test(`${name} is a lazy chunk, not part of the shell`, () => {
      const shell = new Set([...closure(m, entryKeys())].map((k) => join(CLIENT, (m[k] as Entry).file)));
      const all = jsFiles(join(CLIENT, '_app'));
      const holders = all.filter((f) => readFileSync(f, 'utf8').includes(marker));
      expect(holders.length, `${name} is in the build`).toBeGreaterThan(0);
      expect(
        holders.filter((f) => shell.has(f)),
        `${name} must not be in the shell`,
      ).toEqual([]);
    });

  // WP-592: the MapLibre stylesheet makes the map container positioned. It belongs to the lazy renderer chunk
  // (the browser loads it with that chunk), never to the shell: the shell has a size budget.
  test('the MapLibre stylesheet ships with the lazy map chunk, not with the shell', () => {
    const holders = Object.entries(m).filter(([, e]) =>
      (e.css ?? []).some((c) => readFileSync(join(CLIENT, c), 'utf8').includes('.maplibregl-map')),
    );
    expect(holders.map(([k]) => k)).toEqual([expect.stringContaining('maplibre/renderer.ts')]);
    const shell = closure(m, entryKeys());
    expect(
      holders.filter(([k]) => shell.has(k)),
      'the MapLibre stylesheet must not be in the shell',
    ).toEqual([]);
  });
});
