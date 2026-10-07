/**
 * The evaluation corpus world (eval-cases.ts) as SQLite statements, so the parity test can run every case
 * through `evaluate` and through `toSql` over the same data. No SQLite import here (core is pure); the spec
 * feeds the statements to a real database. The tables are the platform tables of docs/04, reduced to the
 * columns the translator reads.
 */
import type { FeatureId, Json, Key } from '../../model';
import { NOW, evalContext, features } from './eval-cases';

export type SqlStatement = readonly [sql: string, params: readonly (string | number | null)[]];

export const WORLD_DDL: readonly string[] = [
  "CREATE TABLE features (id TEXT PRIMARY KEY, type TEXT NOT NULL, properties TEXT NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'active')",
  'CREATE TABLE edges (from_id TEXT NOT NULL, relation TEXT NOT NULL, to_id TEXT NOT NULL, PRIMARY KEY (from_id, relation, to_id))',
  'CREATE INDEX edges_by_to ON edges (to_id, relation)',
  'CREATE TABLE observations (seq INTEGER PRIMARY KEY, feature_id TEXT NOT NULL, property TEXT NOT NULL, result TEXT, phenomenon_time TEXT)',
  'CREATE INDEX observations_by_feature ON observations (feature_id, property, seq)',
];

const IDS = ['b1', 'b2', 'f1', 'k1', 'k2'];
// the keys and relations the corpus world uses; the values come from `features`, the one source of truth
const KEYS = [
  'stage',
  'hoehe',
  'art',
  'alter',
  'geom',
  'tags',
  'pruefung',
  'meta',
  'name',
  'ok',
  'datum',
  'note',
];
const RELATIONS = ['flaeche', 'kontrollen', 'baeume'];

/** Inserts of the world: features, edges and the observation history. */
export function worldStatements(): SqlStatement[] {
  const out: SqlStatement[] = [];
  for (const id of IDS) {
    const fid = id as FeatureId;
    const properties: Record<string, Json> = {};
    for (const k of KEYS) {
      const v = features.property(fid, k);
      if (v !== undefined) properties[k] = v;
    }
    out.push([
      'INSERT INTO features (id, type, properties) VALUES (?, ?, ?)',
      [id, features.type(fid) as string, JSON.stringify(properties)],
    ]);
    for (const rel of RELATIONS)
      for (const to of features.related(fid, rel as Key))
        out.push(['INSERT INTO edges (from_id, relation, to_id) VALUES (?, ?, ?)', [id, rel, to]]);
  }
  let seq = 0;
  for (const id of IDS)
    for (const k of KEYS)
      // `history` is newest first; observations are stored oldest first
      for (const o of [...features.history(id as FeatureId, k, 10)].reverse())
        out.push([
          'INSERT INTO observations (seq, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?)',
          [++seq, id, k, JSON.stringify(o.result), o.phenomenonTime ?? null],
        ]);
  return out;
}

/** The variables of the corpus that are plain data (everything except the feature rows). */
export function dataVars(): Map<string, Json> {
  const vars = new Map<string, Json>();
  for (const [k, v] of evalContext().vars) if (!['self', 'other', 'area'].includes(k)) vars.set(k, v as Json);
  vars.set('now', NOW);
  return vars;
}
