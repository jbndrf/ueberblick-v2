export interface Failure {
  suite?: string;
  spec: string;
  title: string;
  status: string;
  failingStep: string;
  error: string;
  console: string;
  network: string;
  trace: string;
  attachments: { name?: string; path?: string; contentType?: string }[];
}
export const MAX_PROMPT_CHARS: number;
export function collectFailures(report: unknown): Failure[];
export function traceSummary(trace: string, network: string): string;
export function buildPrompt(failure: Failure, image?: Buffer | null): { role: string; content: unknown }[];
export function runTriage(opts: {
  reports: { suite: string; report: unknown }[];
  model: { chat: (messages: never[], opts?: unknown) => Promise<unknown>; gpuFree: () => Promise<boolean> };
  dir: string;
  now?: Date;
  waitMs?: number;
  readTrace?: (f: Failure) => { trace: string; network: string } | null;
  readImage?: (f: Failure) => Buffer | null;
}): Promise<{
  byClass: Record<string, number>;
  bySuite: Record<string, number>;
  tokens: { in: number; out: number; image: number };
  file: string;
}>;
export function waitForGpu(
  model: { gpuFree: () => Promise<boolean> },
  waitMs: number,
  intervalMs?: number,
): Promise<boolean>;
