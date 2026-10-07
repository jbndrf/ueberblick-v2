// A fake benchmark over HARD_FACTOR x its budget, judged through assertBudget (WP-913).
import { it } from 'vitest';
import { assertBudget, defineBudget, report } from '../budget.mjs';

it('fake assert hard breach', () => {
  assertBudget(
    report(
      defineBudget({
        id: 'fake-assert-hard',
        limit: 100,
        unit: 'ms',
        derivedFrom: 'harness test',
        device: 'server',
      }),
      300,
    ),
  );
});
