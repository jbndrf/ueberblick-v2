export interface JournalPair {
  featureId: string;
  property: string;
}
export interface JournalErasure {
  subject: string;
  sourceRun: string;
  actor: string;
  actorKind: string;
  task: string;
  input: Record<string, unknown> | null;
  created: string | null;
  erasedAt: string;
  pairs: JournalPair[];
}
export interface JournalEntry {
  erasures: JournalErasure[];
}
export interface Journal {
  version: number;
  projects: Record<string, JournalEntry>;
}
export function exportJournal(dataDir: string): Journal;
export function journalEntry(raw: unknown): JournalEntry;
