/**
 * Budget (WP-044, docs/12 hot paths): evaluate a 50-field form <= 2 ms; the incremental step a keystroke
 * costs, finding the fields to re-read via `dependents`, <= 0.5 ms.
 * Run: npm test -- -c bench/vitest.config.ts bench/form
 */
import { describe, it } from 'vitest';
import { formApi } from '../../packages/core/src/form';
import { FILE, ctx, world } from '../../packages/core/src/form/__fixtures__';
import type { Json, Key } from '../../packages/core/src/model';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const N = 50;
const props = Object.fromEntries(Array.from({ length: N }, (_, i) => [`f${i}`, { type: 'number' }]));
const form = Object.fromEntries(
  Array.from({ length: N }, (_, i) => [
    `f${i}`,
    i === 0
      ? { required: true }
      : {
          relevant: `form.f${i - 1} != 13`,
          required: `form.f${i - 1} > 5`,
          constraint: 'value >= 0 && value < 1000',
          ...(i % 5 === 0 && i > 1 && { readonly: true, calculate: `form.f${i - 1} + form.f${i - 2} + 1` }),
        },
  ]),
);
const file = {
  ...FILE,
  types: { baum: { label: { de: 'Baum' }, properties: props } },
  tasks: { big: { label: { de: 'Big' }, on: 'baum', form } },
};
const config = world(file);
const c = ctx(config);
const T = 'big' as Key;
const values: Record<string, Json> = Object.fromEntries(
  Array.from({ length: N }, (_, i) => [`f${i}`, (i * 7) % 90]),
);

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const time = (fn: () => void): number => {
  for (let i = 0; i < 200; i++) fn();
  const runs = Array.from({ length: 200 }, () => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  });
  return Math.round(median(runs) * 1000) / 1000;
};

describe('bench: form', () => {
  it('evaluate, 50 fields', () => {
    const ms = time(() => formApi.evaluate(T, config, values, c));
    assertBudget(
      report(
        defineBudget({
          id: 'form-evaluate-50',
          limit: 2,
          unit: 'ms',
          derivedFrom: 'interaction-to-next-paint: a keystroke in a form re-evaluates on the main thread',
          device: 'x4',
          thread: 'main',
        }),
        ms,
      ),
    );
  });

  it('incremental: dependents of one field', () => {
    const ms = time(() => formApi.dependents(T, config, 'f30' as Key));
    assertBudget(
      report(
        defineBudget({
          id: 'form-dependents-50',
          limit: 0.5,
          unit: 'ms',
          derivedFrom: 'interaction-to-next-paint: a keystroke in a form re-evaluates on the main thread',
          device: 'x4',
          thread: 'main',
        }),
        ms,
      ),
    );
  });
});
