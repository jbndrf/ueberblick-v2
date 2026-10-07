// A fake benchmark for the harness tests: reports a value three times over its budget.
import { it } from 'vitest';
import { defineBudget, report } from '../budget.mjs';

it('fake hard breach', () => {
  report(
    defineBudget({ id: 'fake-hard', limit: 100, unit: 'ms', derivedFrom: 'harness test', device: 'server' }),
    300,
  );
});
