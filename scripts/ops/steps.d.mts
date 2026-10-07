export interface StepResult {
  name: string;
  ms: number;
  exit: number;
  parallel?: true;
  killed?: true;
}
export function runSteps(
  names: string[],
  run: (name: string) => Promise<number>,
  now?: () => number,
): Promise<{ steps: StepResult[]; exitCode: number; failedStep: string | null }>;
export function runStepsParallel(
  names: string[],
  run: (name: string, signal: AbortSignal) => Promise<{ exit: number; output: string }>,
  now?: () => number,
  print?: (name: string, output: string, exit: number) => void,
  opts?: { failFast?: boolean },
): Promise<{ steps: StepResult[]; exitCode: number; failedStep: string | null }>;
