import type { Journal, JournalEntry } from './journal.mjs';

export const STAGING_SUFFIX: string;
export interface ReplayResult {
  replayed: number;
  orphanedBlobs: string[];
}
export function replayProject(
  path: string,
  entry: JournalEntry,
  deps: { clock: { now(): string } },
): ReplayResult;
export function restoreWithReplay(input: {
  replica: string;
  dataDir: string;
  databases: string[];
  journal: Journal | undefined;
  restore?: (url: string, out: string) => { ok: boolean; message: string };
  clock: { now(): string };
  pathEnv?: string;
}): { ok: boolean; problems: string[]; results: ({ file: string } & ReplayResult)[] };
