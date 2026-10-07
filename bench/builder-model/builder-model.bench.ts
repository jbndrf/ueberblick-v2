/**
 * Budget (WP-378, R14): the Felder hub of the Modell view builds in <= 200 ms for an Objektart with 300 properties
 * (desktop tooling, not a device budget). It is a pure function of the effective file, run per render.
 * Run: npm run bench -- bench/builder-model
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openProject } from '../../packages/builder/src/doc';
import { musterstadt } from '../../packages/builder/src/testing/golden';
import { buildFieldHub } from '../../packages/builder/src/v3/model/fields/hub';

const best = (f: () => void, n = 7): number => {
  let m = Infinity;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    f();
    m = Math.min(m, performance.now() - t);
  }
  return m;
};

describe('Felder hub: 300 properties', () => {
  it('builds the tabs, lines and used-in in <= 200 ms', () => {
    const base = openProject(musterstadt.templateSrc, musterstadt.overlaySrc).effective();
    const properties = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`feld_${i}`, { type: 'text', label: { de: `Feld ${i}` } }]),
    );
    const big = {
      ...base,
      types: { ...base.types, baum: { ...base.types?.['baum'], properties } },
    } as typeof base;
    const ms = best(() => void buildFieldHub(big, 'baum', 'de'));
    console.info(`builder-model buildFieldHub (300 properties): ${ms.toFixed(1)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'builder-model-field-hub',
          limit: 200,
          unit: 'ms',
          derivedFrom:
            'interaction-to-next-paint: first render of the Felder tab; desktop tooling, not a device budget',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(ms.toFixed(1)),
      ),
    );
  });
});
