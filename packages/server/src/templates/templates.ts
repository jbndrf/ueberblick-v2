/**
 * Published templates in control.db (docs/04, F13): the `templates` table implements the WP-112
 * `TemplateSource` port. A published (key, version) is immutable.
 */
import {
  compile,
  NO_ASSETS,
  serialize,
  TemplateFileSchema,
  type Problem,
  type TemplateFile,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { TemplateSource } from '../deploy';
import { parseStoredTemplate } from '../deploy/old-format';

export type PublishResult =
  | { readonly ok: true; readonly created: boolean }
  | { readonly ok: false; readonly problems: readonly Problem[] }
  | { readonly ok: false; readonly error: string };

/** Compiles and stores a template. Identical re-publish is a no-op; changed content under the same version is refused. */
export function publishTemplate(db: Db, file: TemplateFile, clock: { now(): string }): PublishResult {
  const shape = TemplateFileSchema.safeParse(file);
  if (!shape.success) return { ok: false, error: shape.error.issues.map((i) => i.message).join('; ') };
  const r = compile(file, { assets: NO_ASSETS });
  if (!r.ok) return { ok: false, problems: r.problems };
  const { key, version } = file.template;
  const source = JSON.stringify(file);
  return db.transaction((): PublishResult => {
    const row = db
      .prepare<{ source: string }>('SELECT source FROM templates WHERE key = ? AND version = ?')
      .get(key, version);
    if (row) {
      return row.source === source
        ? { ok: true, created: false }
        : { ok: false, error: `Template ${key}@${version} is already published with different content.` };
    }
    db.prepare('INSERT INTO templates (key, version, source, compiled, published_at) VALUES (?,?,?,?,?)').run(
      key,
      version,
      source,
      JSON.stringify(serialize(r.config)),
      clock.now(),
    );
    return { ok: true, created: true };
  });
}

const parts = (v: string): number[] => (v.split('-')[0] ?? '').split('.').map(Number);
function byVersion(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x?.[i] ?? 0) - (y?.[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `key@major` resolves to the highest published version of that major, `key@1.2.3` to exactly that one. */
export function controlTemplateSource(db: Db): TemplateSource {
  return {
    resolve(extendsRef: string): TemplateFile | undefined {
      const at = extendsRef.lastIndexOf('@');
      if (at <= 0) return undefined;
      const key = extendsRef.slice(0, at);
      const want = extendsRef.slice(at + 1);
      const rows = db
        .prepare<{ version: string; source: string }>('SELECT version, source FROM templates WHERE key = ?')
        .all(key);
      const exact = want.includes('.');
      const fits = rows.filter((r) => (exact ? r.version === want : r.version.split('.')[0] === want));
      const best = fits.sort((a, b) => byVersion(b.version, a.version))[0];
      return best ? parseStoredTemplate(key, best.version, best.source) : undefined;
    },
  };
}
