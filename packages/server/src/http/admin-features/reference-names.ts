/**
 * The names of the features a page of rows points at (WP-443, A-048): per reference property, the target ids on THIS
 * page and their name by the property's Anzeigefeld, else the display name (core `displayName`, B-014). One indexed
 * `id IN (...)` read per chunk of at most `CHUNK` distinct ids, so the cost is O(page), never O(target table) (R14).
 */
import { displayName, type Json, type NameSource, type TemplateFile } from '@ueberblick/core';
import type { Db } from '../../db/driver';

type TypeDef = NonNullable<TemplateFile['types']>[string];

/** SQLite's variable limit is far above this; small chunks keep each statement cheap. */
export const CHUNK = 200;

/** The language preference of the names: the admin pages are German first. */
const LOCALES: readonly string[] = ['de', 'en'];

export type ReferenceNames = Readonly<Record<string, Readonly<Record<string, string>>>>;

const idsOf = (v: Json | undefined): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function referenceNames(
  db: Db,
  types: NonNullable<TemplateFile['types']>,
  def: TypeDef,
  rows: readonly { readonly [key: string]: Json | undefined }[],
): ReferenceNames {
  const out: Record<string, Record<string, string>> = {};
  const cache = new Map<string, NameSource & { readonly type: string }>();
  for (const [key, p] of Object.entries(def.properties)) {
    if (p.type !== 'reference' || p.to === undefined) continue;
    const wanted = [...new Set(rows.flatMap((r) => idsOf(r[key])))].filter((id) => !cache.has(id));
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const chunk = wanted.slice(i, i + CHUNK);
      const found = db
        .prepare<{ id: string; type: string; properties: string }>(
          `SELECT id, type, properties FROM features WHERE id IN (${chunk.map(() => '?').join(',')})`,
        )
        .all(...chunk);
      for (const r of found)
        cache.set(r.id, {
          id: r.id,
          type: r.type,
          properties: JSON.parse(r.properties) as { [k: string]: Json },
        });
    }
    const names: Record<string, string> = {};
    for (const id of new Set(rows.flatMap((r) => idsOf(r[key])))) {
      const f = cache.get(id);
      if (f !== undefined && f.type === p.to) names[id] = displayName(types[p.to], f, LOCALES, p);
    }
    out[key] = names;
  }
  return out;
}
