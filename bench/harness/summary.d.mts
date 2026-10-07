import type { Budget, BudgetLine } from './budget.mjs';

export function summarise(
  reported: readonly (Budget & { value: number; load?: number })[],
  strict?: boolean,
): {
  lines: BudgetLine[];
  ok: boolean;
};
