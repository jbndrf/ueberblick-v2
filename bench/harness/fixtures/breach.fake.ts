// A fake benchmark for the harness tests: reports a value over its budget.
import { it } from 'vitest';
import { defineBudget, report } from '../budget.mjs';

it('fake breach', () => {
  report(defineBudget({ id: 'fake-breach', limit: 100, unit: 'ms', derivedFrom: 'harness test', device: 'server' }), 250);
});
