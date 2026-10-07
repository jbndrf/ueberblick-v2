/**
 * Budget (WP-201): one keystroke in the YAML lens -> its problems (parse, file schema, dry run
 * through the document model, problems mapped to lines) <= 200 ms (median) on the largest golden overlay.
 * Run: npm test -- -c bench/vitest.config.ts bench/builder-yaml
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openProject } from '../../packages/builder/src/doc';
import { diagnose } from '../../packages/builder/src/lenses/yaml/diagnose';
import { largest } from '../../packages/builder/src/testing/golden';

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('builder YAML lens: keystroke to problems', () => {
  it('diagnose() on the largest golden overlay in <= 200 ms (median)', () => {
    const doc = openProject(largest.templateSrc, largest.overlaySrc);
    diagnose(largest.overlaySrc, doc); // warm up
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      // an edit that changes the data: one more override each time
      const typed = largest.overlaySrc.replace(
        /^override:.*$/m,
        (m) => `${m}\n  types.baum.label: Baum ${i}`,
      );
      const t = performance.now();
      const r = diagnose(typed, doc);
      samples.push(performance.now() - t);
      expect(r.ok).toBe(true);
    }
    const ms = median(samples);
    console.info(
      `builder-yaml diagnose: ${ms.toFixed(2)} ms median (${largest.overlaySrc.length} bytes overlay, ${largest.templateSrc.length} bytes template)`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'builder-yaml-keystroke',
          limit: 200,
          unit: 'ms',
          derivedFrom:
            'interaction-to-next-paint: one keystroke in the builder text editor; the builder is desktop tooling, not a device budget',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(ms.toFixed(2)),
      ),
    );
  });
});
