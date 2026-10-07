// A fake benchmark for the harness tests: reports a value within its budget.
import { it } from 'vitest';
import { defineBudget, report } from '../budget.mjs';

it('fake pass', () => {
  report(defineBudget({ id: 'fake-pass', limit: 100, unit: 'ms', derivedFrom: 'harness test', device: 'server' }), 40);
});
