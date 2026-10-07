/**
 * Budget (WP-210): the plan against the running config version (diff, grouping, mappings) for the
 * largest golden project <= 1000 ms (median). Cold path: one plan per look at the Versions lens.
 * Run: npm test -- -c bench/vitest.config.ts bench/builder-versions
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openProject } from '../../packages/builder/src/doc';
import { buildPlan } from '../../packages/builder/src/lenses/versions/plan';
import { largest } from '../../packages/builder/src/testing/golden';

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('builder Versions lens: plan', () => {
  it('buildPlan() on the largest golden project in <= 1000 ms (median)', () => {
    const doc = openProject(largest.templateSrc, largest.overlaySrc);
    const effective = doc.effective();
    // The running version is the bare template: everything the overlay adds or overrides is in the plan.
    const deployed = doc.template;
    buildPlan({ deployed, effective, featureCounts: {} }); // warm up
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      const plan = buildPlan({ deployed, effective, featureCounts: { baum: 100000 } });
      samples.push(performance.now() - t);
      expect(plan.entries.length).toBeGreaterThanOrEqual(0);
    }
    const ms = median(samples);
    console.info(`builder-versions plan: ${ms.toFixed(2)} ms median (${largest.name})`);
    assertBudget(
      report(
        defineBudget({
          id: 'builder-versions-plan',
          limit: 1000,
          unit: 'ms',
          derivedFrom:
            'a plan is shown once per look at the Versions lens, after a click: 1 s is the "response to a click" limit; the builder is desktop tooling',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(ms.toFixed(2)),
      ),
    );
  });
});
