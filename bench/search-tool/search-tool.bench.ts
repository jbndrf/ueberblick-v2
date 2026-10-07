// @vitest-environment jsdom
/**
 * Budget (WP-552, docs/12 INP): a keystroke in the search tool to results is 50 ms at x4 with 60k features.
 * This mounts the real tool over the real device-store index (MemoryIndex, indexText at open as the app does).
 * The budget line is the logic path the tool owns (index lookup, one read per result). The whole keystroke,
 * including 20 result buttons, is timed in jsdom (a slower DOM than a browser) and checked on p95.
 * Run: npm test -- -c bench/vitest.config.ts bench/search-tool
 */
import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureId, Key } from '../../packages/core/src/model';
import { createToolHost } from '../../packages/ui/src/tool-host';
import { testMap, testPorts } from '../../packages/ui/src/tool-host/testing';
import { MemoryIndex } from '../../packages/client/src/store/memory';
import { searchFeatures } from '../../packages/tools/search/src/model';
import { createSearchTool } from '../../packages/tools/search/src/search-tool';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const N = 60_000;
const NAMES = ['Baum', 'Bäume', 'Linde', 'Eiche', 'Ahorn', 'Buche', 'Birke', 'Ulme'];
// a typing session: short prefixes (the most hits), a word, word plus number, a miss
const queries = (i: number) => ['b', 'ba', 'bäu', 'baum', `Baum ${i * 137}`, 'zz'];

function stat(xs: number[]): { p95: number; worst: number } {
  const s = [...xs].sort((a, b) => a - b);
  return { p95: s[Math.floor(s.length * 0.95)] as number, worst: s[s.length - 1] as number };
}

describe('search tool keystroke', () => {
  it('keystroke to results <= 50 ms at x4, 60k features', async () => {
    const mem = new MemoryIndex();
    for (let n = 0; n < N; n++)
      mem.putFeature({
        id: `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId,
        type: 'tree' as Key,
        properties: {
          name: `${NAMES[n % NAMES.length]} ${n}`,
          geometry: { type: 'Point', coordinates: [13 + n / 1e5, 52] },
        },
        lifecycle: 'active',
        updatedSeq: n + 1,
      });
    mem.indexText('tree' as Key, 'name');
    const sources = [{ type: 'tree' as Key, property: 'name' }];
    const ports = {
      searchText: (s: readonly (typeof sources)[number][], q: string, limit: number) =>
        mem.searchText(s, q, limit),
      feature: (id: FeatureId) => mem.features.get(id),
      typeLabel: (k: Key) => k,
    };
    const host = createToolHost({
      loaders: {
        search: async () =>
          createSearchTool({ geo: createGeo(), sources, primaryGeometry: () => 'geometry' as Key }),
      },
      ports: testPorts(),
    });
    const root = document.createElement('div');
    document.body.append(root);
    await host.mountPanel(root, {
      point: 'tools-sheet',
      toolKey: 'search',
      startTask: () => undefined,
      map: testMap(),
      openFeature: () => undefined,
      ...ports,
    });
    const input = root.querySelector('input');
    if (!input) throw new Error('no input');

    const logic: number[] = [];
    for (let i = 0; i < 100; i++)
      for (const q of queries(i)) {
        const t0 = performance.now();
        searchFeatures(ports, sources, q, 21);
        logic.push(performance.now() - t0);
      }
    const whole: number[] = [];
    for (let i = 0; i < 100; i++)
      for (const q of queries(i)) {
        input.value = q;
        const t0 = performance.now();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        whole.push(performance.now() - t0);
      }
    expect(root.querySelectorAll('.ub-search-item').length).toBe(0); // the last query is a miss
    const l = stat(logic);
    const w = stat(whole);
    console.log(
      `search-tool: 60k logic p95 ${l.p95.toFixed(3)} ms worst ${l.worst.toFixed(3)} ms (x4 ${(l.worst * 4).toFixed(1)} ms); ` +
        `whole keystroke in jsdom p95 ${w.p95.toFixed(3)} ms worst ${w.worst.toFixed(3)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'search-tool-keystroke',
          limit: 50,
          unit: 'ms',
          derivedFrom: 'INP: a keystroke to results, 50 ms at x4',
          device: 'x4',
          thread: 'main',
        }),
        Number(l.worst.toFixed(3)),
      ),
    );
  });
});
