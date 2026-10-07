import type { Db } from '../db/driver';
import type { Draft, DraftStore } from './contract';

interface Row {
  template: string;
  template_version: string;
  overlay: string;
  revision: number;
  updated_by: string | null;
  updated_at: string;
}

const COLUMNS = 'template, template_version, overlay, revision, updated_by, updated_at';

const draft = (r: Row): Draft => ({
  template: r.template,
  templateVersion: r.template_version,
  overlay: r.overlay,
  revision: r.revision,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

/** The SQLite adapter of `DraftStore` (table `builder_draft`, migration 2). */
export function createDraftStore(db: Db): DraftStore {
  const get = (): Draft | undefined => {
    const r = db.prepare<Row>(`SELECT ${COLUMNS} FROM builder_draft WHERE id = 1`).get();
    return r && draft(r);
  };
  return {
    get,
    seed(d) {
      db.prepare(`INSERT OR IGNORE INTO builder_draft (id, ${COLUMNS}) VALUES (1, ?, ?, ?, 1, ?, ?)`).run(
        d.template,
        d.templateVersion,
        d.overlay,
        d.by,
        d.at,
      );
      return get() as Draft;
    },
    reset(d) {
      db.prepare(
        `INSERT INTO builder_draft (id, ${COLUMNS}) VALUES (1, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET template = excluded.template, template_version = excluded.template_version,
           overlay = excluded.overlay, revision = revision + 1, updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).run(d.template, d.templateVersion, d.overlay, d.by, d.at);
      return get() as Draft;
    },
    putIf(expected, overlay, by, at) {
      // One statement: the revision test and the write cannot be split by another writer.
      const res = db
        .prepare(
          'UPDATE builder_draft SET overlay = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = 1 AND revision = ?',
        )
        .run(overlay, by, at, expected);
      const current = get();
      return res.changes === 1 && current ? { ok: true, draft: current } : { ok: false, draft: current };
    },
  };
}
