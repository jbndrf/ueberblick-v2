/**
 * Budget (docs/12, WP-044): a keystroke on a 50-field form (set, visible fields, validate page) must fit one
 * 60 fps frame, 16 ms, of the interaction-to-next-paint row on the reference phone (node time x4). Median of
 * 15 batches of 20 keystrokes.
 * Run: npm test -- -c bench/vitest.config.ts bench/ui-form
 */
import { describe, it } from 'vitest';
import type { Property } from '@ueberblick/core/model';
import { buildFormModel } from '../../packages/ui/src/form/model';
import { createFormSession } from '../../packages/ui/src/form/session';
import { sessionOptions } from '../../packages/ui/src/form/form.testing';
import { defineBudget, report } from '../harness/budget.mjs';

const properties: Record<string, Property> = {};
const form: Record<string, { relevant?: string; constraint: string }> = {};
for (let i = 0; i < 50; i++) {
  properties[`f${i}`] = { type: 'text' } as Property;
  form[`f${i}`] = { constraint: "value != 'x'", ...(i > 0 && { relevant: "form.f0 != 'hide'" }) };
}
const input = { form, properties };

const BATCHES = 15;
const KEYS = 20;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('bench: form session', () => {
  it('a keystroke on a 50-field form', () => {
    const s = createFormSession(buildFormModel(input), sessionOptions(input));
    for (let k = 0; k < 20; k++) s.set('f0', `w${k}`);
    const runs: number[] = [];
    for (let b = 0; b < BATCHES; b++) {
      const t0 = performance.now();
      for (let k = 0; k < KEYS; k++) {
        s.set('f0', `a${b}-${k}`);
        s.visibleFields(0);
        s.validatePage(0);
      }
      runs.push((performance.now() - t0) / KEYS);
    }
    report(
      defineBudget({
        id: 'form-keystroke-50-fields',
        limit: 16,
        unit: 'ms',
        derivedFrom: 'interaction-to-next-paint: one keystroke in a 50-field form fits one 60 fps frame',
        device: 'x4',
        thread: 'main',
      }),
      Number(median(runs).toFixed(2)),
    );
  });
});
