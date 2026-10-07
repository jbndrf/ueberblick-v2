import { describe, expect, it } from 'vitest';
import { checkStepsRows } from './check-steps-rows.mjs';

// WP-930: the metrics report shows check wall time per suite and per step.
describe('checkStepsRows', () => {
  it('is empty without entries', () => {
    expect(checkStepsRows([])).toEqual([]);
  });

  it('summarises suites and steps with p50, p90, red count and load', () => {
    const rows = checkStepsRows([
      {
        suite: 'check',
        wallMs: 100_000,
        exitCode: 0,
        load1: 30,
        steps: [
          { name: 'check:fast', ms: 60_000, exit: 0 },
          { name: 'test:record', ms: 40_000, exit: 0 },
        ],
      },
      {
        suite: 'check',
        wallMs: 70_000,
        exitCode: 1,
        load1: 50,
        steps: [
          { name: 'check:fast', ms: 50_000, exit: 0 },
          { name: 'test:record', ms: 20_000, exit: 1 },
        ],
      },
    ]);
    expect(rows).toEqual([
      ['suite check', '2', '100.0 s', '100.0 s', '1', '50'],
      ['check:fast', '2', '60.0 s', '60.0 s', '0', '50'],
      ['test:record', '2', '40.0 s', '40.0 s', '1', '50'],
    ]);
  });
});
