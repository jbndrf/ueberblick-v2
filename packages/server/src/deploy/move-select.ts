/**
 * Which features a value move touches, and how many (WP-307). One definition (R1): the executor selects with
 * `featuresToMove`, the plan counts with `affectedCount`, and both use `holds`. Version pinning (A-029, WP-317) skips
 * pinned features: `liveAnd` carries that one predicate, so a feature kept on its old version is neither counted nor moved. "Live" is every lifecycle state that keeps values (the
 * registry's `keepsValues` flag, `keepsValuesSql`): all but `deleted`; archived features are moved too, so a restore
 * shows no stale option.
 */
import { parseKeyPath, keepsValuesSql, type DiffEntry } from '@ueberblick/core';
import type { Db, SqlValue } from '../db/driver';

/** What a `{ to }` mapping asks for; `from`/`to` move an option, `to_property` moves a property's value. */
export type MovePayload =
  | { readonly type: string; readonly property: string; readonly from: string; readonly to: string }
  | { readonly type: string; readonly property: string; readonly to_property: string }
  /** WP-312: every live feature of `type` gets a `$recompute` run (a computed property was added or changed). */
  | { readonly type: string; readonly recompute: true };

/**
 * The one predicate of "which features": live ones of a type that float (`pinned_version IS NULL`), or, for the manual
 * move of the pins of version N (WP-368), those pinned to exactly N. `pinnedTo` is an integer, so it is inlined.
 */
function liveAnd(pinnedTo?: number): string {
  if (pinnedTo !== undefined && !Number.isInteger(pinnedTo)) throw new Error('pinnedTo must be an integer');
  const pin = pinnedTo === undefined ? 'pinned_version IS NULL' : `pinned_version = ${pinnedTo}`;
  return `type = ? AND ${keepsValuesSql('lifecycle')} AND ${pin}`;
}
const jsonPath = (key: string): string => `$."${key.replace(/"/g, '\\"')}"`;

interface Where {
  readonly sql: string;
  readonly params: SqlValue[];
}

/** Live features of `type` that hold `option` in `property` (select value or multiselect member), or any value when absent. */
function holds(type: string, property: string, option: string | undefined, pinnedTo?: number): Where {
  const path = jsonPath(property);
  if (option === undefined)
    return { sql: `${liveAnd(pinnedTo)} AND json_extract(properties, ?) IS NOT NULL`, params: [type, path] };
  return {
    sql:
      `${liveAnd(pinnedTo)} AND (json_extract(properties, ?) = ? OR (json_type(properties, ?) = 'array'` +
      ' AND EXISTS (SELECT 1 FROM json_each(properties, ?) WHERE value = ?)))',
    params: [type, path, option, path, path, option],
  };
}

function selection(move: MovePayload, pinnedTo?: number): Where {
  if ('recompute' in move) return { sql: liveAnd(pinnedTo), params: [move.type] };
  if ('to_property' in move) {
    const w = holds(move.type, move.property, undefined, pinnedTo);
    // A property whose new key already holds a value has nothing to move (`$move` keeps it).
    return {
      sql: `${w.sql} AND json_extract(properties, ?) IS NULL`,
      params: [...w.params, jsonPath(move.to_property)],
    };
  }
  return holds(move.type, move.property, move.from, pinnedTo);
}

/**
 * Up to `limit` live feature ids of the move, in id order, after `after` (`''` from the start). `pinnedTo` selects the
 * features pinned to that version instead of the floating ones (the manual move, WP-368).
 */
export function featuresToMove(
  db: Db,
  move: MovePayload,
  after: string,
  limit: number,
  pinnedTo?: number,
): string[] {
  const w = selection(move, pinnedTo);
  return db
    .prepare<{ id: string }>(`SELECT id FROM features WHERE ${w.sql} AND id > ? ORDER BY id LIMIT ?`)
    .all(...w.params, after, limit)
    .map((r) => r.id);
}

/**
 * The live features a breaking entry touches: a removed or retyped property (those holding a value), a removed option
 * (those holding it) or a removed type (all of it). `undefined` for entries no feature value depends on.
 */
export function affectedCount(db: Db, entry: DiffEntry, pinnedTo?: number): number | undefined {
  if (!entry.breaking) return undefined;
  const s = parseKeyPath(entry.path) ?? [];
  const [section, type, kind, property, sub, option] = s;
  if (section !== 'types' || type === undefined) return undefined;
  let w: Where;
  if (s.length === 2) w = { sql: liveAnd(pinnedTo), params: [type] };
  else if (kind === 'properties' && property !== undefined && (s.length === 4 || s.length === 5))
    w = holds(type, property, undefined, pinnedTo);
  else if (kind === 'properties' && property !== undefined && sub === 'options' && option !== undefined)
    w = holds(type, property, option, pinnedTo);
  else return undefined;
  return (
    db.prepare<{ n: number }>(`SELECT count(*) AS n FROM features WHERE ${w.sql}`).get(...w.params)?.n ?? 0
  );
}
