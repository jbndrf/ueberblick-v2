/**
 * Budget (WP-204): deriving the process graphs of a feature type from the largest golden template
 * takes <= 20 ms (median). Run: npm test -- -c bench/vitest.config.ts bench/builder-process
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openProject } from '../../packages/builder/src/doc';
import { deriveProcesses } from '../../packages/builder/src/lenses/process/graph';
import { layout } from '../../packages/builder/src/lenses/process/layout';

const golden = (rel: string): string =>
  readFileSync(new URL(`../../fixtures/golden/${rel}`, import.meta.url), 'utf8');
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('builder process lens: graph derivation on the largest golden template', () => {
  it('derives every feature type with layout in <= 20 ms (median)', () => {
    const src = ['baumkataster/2.0.0', 'baumkataster/1.1.0', 'maengelmelder/1.0.0', 'veranstaltung/1.0.0']
      .map((f) => ({ f, text: golden(`templates/${f}.yaml`) }))
      .reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const [key, version] = src.f.split('/') as [string, string];
    const file = openProject(
      src.text,
      `schema: ueberblick/1\nextends: ${key}@${version.split('.')[0]}\n`,
    ).effective();
    const types = Object.keys(file.types ?? {});
    const once = () => types.forEach((t) => deriveProcesses(file, t).forEach(layout));
    once(); // warm up
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const t = performance.now();
      once();
      samples.push(performance.now() - t);
    }
    const ms = median(samples);
    console.info(`builder-process derive+layout (all types of ${src.f}): ${ms.toFixed(2)} ms median`);
    assertBudget(
      report(
        defineBudget({
          id: 'builder-process-derive',
          limit: 20,
          unit: 'ms',
          derivedFrom:
            'interaction-to-next-paint: one builder interaction; desktop tooling, not a device budget',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(ms.toFixed(2)),
      ),
    );
  });
});
