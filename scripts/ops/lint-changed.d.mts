export const LINT_CONFIGS: RegExp;
export function lintPlan(
  cwd: string,
  ref: string,
): { scope: 'files'; eslint: string[]; prettier: string[]; line: string } | { scope: 'all'; line: string };
