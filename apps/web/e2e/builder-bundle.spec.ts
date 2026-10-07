import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { BUILDER_BUNDLE_MARKER } from '../../../packages/builder/src/shell/marker';

/**
 * WP-212: builder code is not in the participant bundle. Runs against the real build (`npm run e2e`
 * builds first) and FAILS when there is no build, so the check can never pass by skipping.
 * Participant roots are the client entries and the root layout and error nodes (0 and 1); the
 * static import graph from them must not reach a chunk that holds the builder shell. Dynamic
 * `import()` (route nodes, loaded on navigation) is not part of the graph.
 */
const immutable = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../.svelte-kit/output/client/_app/immutable',
);

const files = (dir: string): string[] =>
  readdirSync(join(immutable, dir)).map((f) => join(immutable, dir, f));

const STATIC_IMPORT = /(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?["']([^"']+\.js)["']/g;

interface Fs {
  read: (file: string) => string;
  exists: (file: string) => boolean;
}
const realFs: Fs = { read: (f) => readFileSync(f, 'utf8'), exists: existsSync };

function staticGraph(roots: readonly string[], fs: Fs = realFs): Set<string> {
  const seen = new Set<string>();
  const todo = [...roots];
  while (todo.length > 0) {
    const file = todo.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of fs.read(file).matchAll(STATIC_IMPORT)) {
      const target = resolve(dirname(file), m[1] as string);
      if (fs.exists(target)) todo.push(target);
    }
  }
  return seen;
}

const holdsBuilder = (file: string): boolean => readFileSync(file, 'utf8').includes(BUILDER_BUNDLE_MARKER);

test('the web app is built (this check never skips)', () => {
  expect(existsSync(join(immutable, 'entry')), 'run `npm run build -w @ueberblick/web` first').toBe(true);
});

test('the participant entry and root layout do not link the builder shell', () => {
  const nodes = files('nodes');
  const rootNodes = nodes.filter((f) => /\/(0|1)\.[^/]+\.js$/.test(f));
  expect(rootNodes).toHaveLength(2);
  const graph = staticGraph([...files('entry'), ...rootNodes]);
  expect(graph.size, 'the import graph was followed').toBeGreaterThan(files('entry').length + 2);
  expect([...graph].filter(holdsBuilder)).toEqual([]);
});

/**
 * The control: the marker exists somewhere (so the check is not vacuous), and no holder, whether a
 * route node or a shared chunk, is in the static graph of the participant roots. Pure over a graph
 * and a holder list so it can be tested on a fake file set.
 */
function controlProblems(holders: readonly string[], participantGraph: ReadonlySet<string>): string[] {
  if (holders.length === 0) return ['no file holds the builder marker (the check would be vacuous)'];
  return holders
    .filter((h) => participantGraph.has(h))
    .map((h) => `${h} is reachable from the participant roots`);
}

test('the builder shell is present and unreachable from the participant roots (positive control)', () => {
  const rootNodes = files('nodes').filter((f) => /\/(0|1)\.[^/]+\.js$/.test(f));
  const graph = staticGraph([...files('entry'), ...rootNodes]);
  const holders = [...files('nodes'), ...files('entry'), ...files('chunks')].filter(holdsBuilder);
  expect(controlProblems(holders, graph)).toEqual([]);
});

test('the control accepts a shared chunk and fails when the participant root imports it (fake file set)', () => {
  const dir = '/x/immutable';
  const src = new Map<string, string>([
    [`${dir}/entry/app.js`, 'import"../nodes/0.js";'],
    [`${dir}/nodes/0.js`, 'import"../chunks/shared.js";'],
    [`${dir}/nodes/5.js`, 'import"../chunks/builder.js";'],
    [`${dir}/chunks/shared.js`, 'export const a=1;'],
    [`${dir}/chunks/builder.js`, 'export const b="BUILDER";'],
  ]);
  const fs: Fs = { read: (f) => src.get(f) ?? '', exists: (f) => src.has(f) };
  const holders = [`${dir}/chunks/builder.js`];
  const ok = staticGraph([`${dir}/entry/app.js`], fs);
  expect(ok.has(`${dir}/chunks/shared.js`)).toBe(true);
  expect(controlProblems(holders, ok)).toEqual([]);
  src.set(`${dir}/nodes/0.js`, 'import"../chunks/builder.js";');
  const bad = staticGraph([`${dir}/entry/app.js`], fs);
  expect(controlProblems(holders, bad)).toHaveLength(1);
  expect(controlProblems([], ok)).toHaveLength(1);
});
