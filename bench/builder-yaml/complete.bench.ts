/**
 * Budget (WP-157): one completion request in the YAML lens (`completeAt`) <= 10 ms at p95 per call,
 * on short random text and on prefixes of the largest golden overlay. Completion runs on every keystroke.
 * Run: npm test -- -c bench/vitest.config.ts bench/builder-yaml
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openProject } from '../../packages/builder/src/doc';
import { completeAt } from '../../packages/builder/src/lenses/yaml/complete';
import { largest } from '../../packages/builder/src/testing/golden';

describe('builder YAML lens: completion per keystroke', () => {
  it('completeAt() p95 per call on random short input and on the golden overlay', () => {
    const doc = openProject(largest.templateSrc, largest.overlaySrc);
    const src = largest.overlaySrc;
    const inputs: [string, number][] = [];
    // A seeded LCG keeps the run reproducible: short random texts, then golden-overlay prefixes.
    let seed = 42;
    const next = (n: number): number => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    const alphabet = 'abc :-\n#{["\'inputsoverride.';
    for (let i = 0; i < 200; i++) {
      const len = next(200);
      let text = '';
      for (let j = 0; j < len; j++) text += alphabet[next(alphabet.length)];
      inputs.push([text, next(len + 1)]);
    }
    for (let i = 0; i < 200; i++) {
      const at = next(src.length);
      const typed = i % 2 === 0;
      inputs.push([src.slice(0, at) + (typed ? '\n  ' : ''), at + (typed ? 3 : 0)]);
    }
    for (const [t, p] of inputs) completeAt(t, p, doc); // warm up
    const samples: number[] = [];
    for (const [t, p] of inputs) {
      const t0 = performance.now();
      completeAt(t, p, doc);
      samples.push(performance.now() - t0);
    }
    const p95 = [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] as number;
    console.info(`builder-yaml completeAt: p95 ${p95.toFixed(3)} ms over ${samples.length} calls`);
    assertBudget(
      report(
        defineBudget({
          id: 'builder-yaml-complete-p95',
          limit: 10,
          unit: 'ms',
          derivedFrom:
            'interaction-to-next-paint: completion runs on every keystroke in the builder text editor; a tenth of the keystroke budget',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(p95.toFixed(3)),
      ),
    );
  });
});
