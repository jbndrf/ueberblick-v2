// WP-363: `submitPlan` steps and constants in the mapping.
import { IMPORT_TASK } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { importFile, planImport, submitPlan } from './import';
import { count, features, importSetup, TREE_MAPPING } from './testkit';

const lines = (n: number): string =>
  ['vit;x;y;z', ...Array.from({ length: n }, (_, i) => `v${i % 5};${500000 + i};5538630;100`)].join('\n');
const mapping = { ...TREE_MAPPING, sourceCrs: 'EPSG:25832' } as const;

describe('submitPlan', () => {
  it('skip mode yields progress per step, from 0 up to the total', () => {
    const { ctx, deps } = importSetup();
    const plan = planImport({ format: 'csv', data: lines(250) }, mapping, deps, { mode: 'skip' });
    const steps = submitPlan(ctx.store, plan, { mode: 'skip', batchSize: 100 });
    const seen: number[] = [];
    let r = steps.next();
    while (!r.done) {
      seen.push(r.value);
      r = steps.next();
    }
    expect(seen).toEqual([100, 200, 250]);
    expect(r.value).toMatchObject({ outcome: 'accepted', imported: 250 });
    expect(count(ctx, 'features')).toBe(250);
  });
});

describe('constants in the mapping', () => {
  it('make the rows `$import` runs; without constants they stay plain runs of the task', () => {
    const { deps } = importSetup();
    const plain = planImport({ format: 'csv', data: lines(2) }, mapping, deps);
    expect(plain.runs[0]?.task).toBe('erfassen');
    const withConstants = planImport(
      { format: 'csv', data: lines(2) },
      { ...mapping, constants: { stage: 'massnahme' } },
      deps,
    );
    expect(withConstants.runs[0]?.task).toBe(IMPORT_TASK);
    expect(withConstants.runs[0]?.input).toMatchObject({
      task: 'erfassen',
      constants: { stage: 'massnahme' },
    });
  });

  it('write the stage through the plan', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(
      ctx.store,
      { format: 'csv', data: lines(3) },
      { ...mapping, constants: { stage: 'massnahme' } },
      deps,
    );
    expect(r).toMatchObject({ outcome: 'accepted', imported: 3 });
    expect(features(ctx).every((f) => f.properties['stage'] === 'massnahme')).toBe(true);
  });
});
