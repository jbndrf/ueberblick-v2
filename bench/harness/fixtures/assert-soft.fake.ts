// A fake benchmark that judges its breach through assertBudget (WP-913): over budget, within HARD_FACTOR x.
import { it } from 'vitest';
import { assertBudget, defineBudget, report } from '../budget.mjs';

it('fake assert soft breach', () => {
  assertBudget(
    report(
      defineBudget({
        id: 'fake-assert-soft',
        limit: 100,
        unit: 'ms',
        derivedFrom: 'harness test',
        device: 'server',
      }),
      150,
    ),
  );
});
