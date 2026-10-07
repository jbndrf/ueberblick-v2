// A fake benchmark for the harness tests: reports a value over its budget but within HARD_FACTOR x.
import { it } from 'vitest';
import { defineBudget, report } from '../budget.mjs';

it('fake soft breach', () => {
  report(
    defineBudget({ id: 'fake-soft', limit: 100, unit: 'ms', derivedFrom: 'harness test', device: 'server' }),
    150,
  );
});
