/**
 * The only config-driven DDL (docs/04): one expression index per property with `index: true`, and a NOCASE twin for text kinds.
 * Names carry the `cfg_idx_` prefix and the length of the type key, so two (type, property) pairs
 * never collide and a drop can never touch a platform index.
 */
import { KeySchema, propertySql, type TemplateFile } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { COLUMN_KIND_OF_TYPE } from '../http/admin-features/registry';

const PREFIX = 'cfg_idx_';

/** Name of the index for one property of one feature type. */
export const indexName = (type: string, property: string): string =>
  `${PREFIX}${type.length}_${type}_${property}`;

/** Name of the case-insensitive index of one text property (serves the admin list's sort). The `nc_` where a binary name has the type's length (digits) keeps the two name sets apart. */
export const noCaseIndexName = (type: string, property: string): string =>
  `${PREFIX}nc_${type.length}_${type}_${property}`;

/** `expr` compared case-insensitively. The admin list sorts by exactly this expression, so the NOCASE index serves it. */
export const noCase = (expr: string): string => `${expr} COLLATE NOCASE`;

/** Property types that are stored elsewhere (the rtree) and cannot be indexed by value. */
const NOT_INDEXABLE: readonly string[] = ['geometry'];

/** The indexes a file asks for: name to CREATE statement. */
export function wantedIndexes(file: TemplateFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const [type, ft] of Object.entries(file.types ?? {})) {
    for (const [prop, p] of Object.entries(ft.properties)) {
      if (p.index !== true || NOT_INDEXABLE.includes(p.type)) continue;
      // Keys are validated by the schema; assert again because they are interpolated into DDL.
      if (!KeySchema.safeParse(type).success || !KeySchema.safeParse(prop).success)
        throw new Error(`unsafe key in index DDL: ${type}.${prop}`);
      const name = indexName(type, prop);
      out.set(name, `CREATE INDEX IF NOT EXISTS "${name}" ON features (type, ${propertySql('', prop)})`);
      // Text kinds get a second, NOCASE index: the binary one serves equality (rules, sync), this one the sort.
      if (COLUMN_KIND_OF_TYPE[p.type] === 'text') {
        const nc = noCaseIndexName(type, prop);
        out.set(
          nc,
          `CREATE INDEX IF NOT EXISTS "${nc}" ON features (type, ${noCase(propertySql('', prop))}, id)`,
        );
      }
    }
  }
  return out;
}

/** Brings the `cfg_idx_*` indexes in line with the file. Call inside the deploy transaction. */
export function reconcileIndexes(db: Db, file: TemplateFile): void {
  const wanted = wantedIndexes(file);
  const existing = db
    .prepare<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'cfg\\_idx\\_%' ESCAPE '\\'`,
    )
    .all();
  for (const { name } of existing) if (!wanted.has(name)) db.exec(`DROP INDEX "${name}"`);
  for (const sql of wanted.values()) db.exec(sql);
}
