/**
 * C-004: the top-level `rules:` section is gone (automatic actions live in `tasks.<t>.auto`). Stored data written
 * before that (a version's file, a published template's source) would otherwise lose its automatic actions
 * silently, so it is refused with a named error: only that project (or template) fails to load, never the server.
 */
import { TemplateFileSchema, type TemplateFile } from '@ueberblick/core';
import type { Db } from '../db/driver';

export const OLD_FORMAT_RULES = 'old_format_rules';

/** The stored data still has a top-level `rules:`; re-seed or migrate it. */
export class OldFormatRulesError extends Error {
  readonly code = OLD_FORMAT_RULES;
  constructor(what: string) {
    super(`${OLD_FORMAT_RULES}: ${what} still has rules: — re-seed or migrate`);
    this.name = 'OldFormatRulesError';
  }
}

/** True when a stored file (parsed JSON or YAML) has a top-level `rules` key. */
export const hasOldRules = (file: unknown): boolean =>
  typeof file === 'object' && file !== null && !Array.isArray(file) && 'rules' in file;

/** The project a database file belongs to (`project-<key>.db`), else its file name, else "(unnamed)". */
export function projectNameOf(db: Db): string {
  const main = db
    .prepare<{ name: string; file: string }>('PRAGMA database_list')
    .all()
    .find((r) => r.name === 'main');
  const base = main?.file.split(/[\\/]/).pop() ?? '';
  const m = /^project-(.+)\.db$/.exec(base);
  return m?.[1] ?? (base === '' ? '(unnamed)' : base);
}

/** Refuses a stored version whose file still has `rules:`. */
export function assertNoOldRules(db: Db, version: number, file: unknown): void {
  if (hasOldRules(file)) throw new OldFormatRulesError(`project ${projectNameOf(db)} version ${version}`);
}

/** A stored template's `source` column as a file; a source that still has `rules:` is a named error, not a ZodError. */
export function parseStoredTemplate(key: string, version: string, source: string): TemplateFile {
  const value: unknown = JSON.parse(source);
  if (hasOldRules(value)) throw new OldFormatRulesError(`template ${key} version ${version}`);
  return TemplateFileSchema.parse(value);
}
