/**
 * Budget (docs/12): compile of a 500-entity file <= 200 ms. Seeded, deterministic input.
 * Run: npm test -- -c bench/vitest.config.ts bench/compile
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { compile, hydrate, NO_ASSETS, serialize } from '../../packages/core/src/schema/compile';
import { goldenAssets } from '../../packages/core/src/testing/golden';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { TemplateFileSchema } from '../../packages/core/src/schema/file';
import { generate } from './generate';

const file = generate();
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

function time(fn: () => void, runs = 15): number {
  fn(); // warm up
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  return median(samples);
}

describe('compile of a 500-entity file', () => {
  it('compiles in <= 200 ms (median)', () => {
    const r = compile(file, { assets: NO_ASSETS });
    if (!r.ok) throw new Error(`bench file must compile: ${JSON.stringify(r.problems.slice(0, 3))}`);
    const ms = time(() => void compile(file, { assets: NO_ASSETS }));
    console.info(`compile: ${ms.toFixed(1)} ms median, ${r.config.expressions.size} expressions`);
    assertBudget(
      report(
        defineBudget({
          id: 'compile-500',
          limit: 200,
          unit: 'ms',
          derivedFrom: 'compile once (docs/12 rules of thumb): deploy time, no row of its own',
          device: 'server',
        }),
        Number(ms.toFixed(1)),
      ),
    );
  });

  it('hydrates far faster than it compiles', () => {
    const r = compile(file, { assets: NO_ASSETS });
    if (!r.ok) throw new Error('bench file must compile');
    const data = JSON.parse(JSON.stringify(serialize(r.config)));
    const ms = time(() => void hydrate(data));
    console.info(`hydrate: ${ms.toFixed(1)} ms median`);
    assertBudget(
      report(
        defineBudget({
          id: 'hydrate-500',
          limit: 50,
          unit: 'ms',
          derivedFrom: 'cold-start-60k: config hydrate on the device is a small share of cold start',
          device: 'x4',
          thread: 'main',
        }),
        Number(ms.toFixed(1)),
      ),
    );
  });

  it('hydrates the largest golden template in <= 5 ms (shell budget)', () => {
    const dir = new URL('../../fixtures/golden/templates/', import.meta.url);
    const sources = ['baumkataster/2.0.0.yaml', 'maengelmelder/1.0.0.yaml', 'veranstaltung/1.0.0.yaml'];
    const compiled = sources.map((f) => {
      const r = compile(TemplateFileSchema.parse(parse(readFileSync(new URL(f, dir), 'utf8'))), {
        assets: goldenAssets,
      });
      if (!r.ok) throw new Error(`${f} must compile`);
      return JSON.parse(JSON.stringify(serialize(r.config)));
    });
    const largest = compiled.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    const ms = time(() => void hydrate(largest), 50);
    console.info(`hydrate (largest golden template): ${ms.toFixed(2)} ms median`);
    assertBudget(
      report(
        defineBudget({
          id: 'hydrate-golden',
          limit: 5,
          unit: 'ms',
          derivedFrom: 'cold-start-60k: config hydrate on the device is a small share of cold start',
          device: 'x4',
          thread: 'main',
        }),
        Number(ms.toFixed(2)),
      ),
    );
  });
});
