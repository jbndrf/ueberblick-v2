export type SilentRed =
  | { kind: 'suite'; file: string; message: string }
  | { kind: 'unhandled'; message: string }
  | { kind: 'unknown'; tail: string };
export function silentRed(input: {
  code: number;
  report: {
    numFailedTests?: number;
    testResults?: { name?: string; status?: string; message?: string; assertionResults?: unknown[] }[];
    unhandledErrors?: unknown[];
  } | null;
  stderr?: string;
}): SilentRed | undefined;
