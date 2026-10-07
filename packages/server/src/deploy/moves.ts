/**
 * Mappings of a deploy (WP-307, replaces the A-024 refusal): validated against the diff of the deploy, and every
 * `{ to }` recorded as one `deploy_moves` row in the deploy transaction. The executor (`move-executor.ts`) runs them.
 * `{ discard }` needs no row: the values stay in the history and nothing moves.
 */
import {
  formatKeyPath,
  parseKeyPath,
  type DiffEntry,
  type Problem,
  type TemplateFile,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { ValueMapping } from './contract';
import type { MovePayload } from './move-select';

const text = (en: string, de: string) => ({ en, de });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** What a removed option (`types.T.properties.P.options.O`) or property (`types.T.properties.P`) can move to. */
interface Removed {
  readonly type: string;
  readonly property: string;
  readonly option?: string;
}

/** The removed option or property at `path`, the only things whose values can move. */
function removedAt(path: string, e: DiffEntry): Removed | undefined {
  const s = parseKeyPath(path) ?? [];
  const [section, type, kind, property, sub, option] = s;
  if (e.change !== 'removed' || section !== 'types' || kind !== 'properties') return undefined;
  if (type === undefined || property === undefined) return undefined;
  if (s.length === 4) return { type, property };
  return s.length === 6 && sub === 'options' && option !== undefined ? { type, property, option } : undefined;
}

/** The payload for `to`, or a problem when `to` is not another option or property of the new version. */
function payloadOf(path: string, r: Removed, to: string, file: TemplateFile): MovePayload | Problem {
  const props = (file.types as Record<string, { properties?: Record<string, unknown> }> | undefined)?.[r.type]
    ?.properties;
  const noOption = r.option !== undefined;
  const found = noOption ? (props?.[r.property] as { options?: unknown } | undefined)?.options : props;
  if (isObj(found) && Object.hasOwn(found, to) && to !== (r.option ?? r.property))
    return r.option !== undefined
      ? { type: r.type, property: r.property, from: r.option, to }
      : { type: r.type, property: r.property, to_property: to };
  return {
    path,
    code: 'dangling_reference',
    message: text(
      `"${to}" is not ${noOption ? 'another option' : 'another property'} in the new version, so the values cannot move there.`,
      `"${to}" ist in der neuen Version ${noOption ? 'keine andere Option' : 'keine andere Eigenschaft'}, die Werte können dort nicht hin.`,
    ),
    hint: 'Choose an option or property that exists in the file, or discard the values.',
  };
}

export interface PlannedMoves {
  readonly moves: readonly { readonly path: string; readonly payload: MovePayload }[];
  readonly problems: readonly Problem[];
}

/** Checks every mapping against the breaking entries of the deploy; the `{ to }` ones become moves. */
export function checkMappings(
  changes: readonly DiffEntry[],
  mappings: Readonly<Record<string, ValueMapping>>,
  file: TemplateFile,
): PlannedMoves {
  const breaking = new Map(changes.filter((c) => c.breaking).map((c) => [c.path, c]));
  const moves: { path: string; payload: MovePayload }[] = [];
  const problems: Problem[] = [];
  for (const [path, m] of Object.entries(mappings)) {
    const entry = breaking.get(path);
    if (entry === undefined) {
      problems.push({
        path,
        code: 'unknown_path',
        message: text(
          `"${path}" is not a breaking change of this deploy, so it takes no mapping.`,
          `"${path}" ist keine brechende Änderung dieses Deploys und braucht keine Zuordnung.`,
        ),
        hint: 'Remove the mapping, or check the path against the plan.',
      });
      continue;
    }
    if (!('to' in m)) continue;
    const removed = removedAt(path, entry);
    if (removed === undefined) {
      problems.push({
        path,
        code: 'schema_invalid',
        message: text(
          `The values of "${path}" cannot move: only a removed option or property has values to move.`,
          `Die Werte von "${path}" lassen sich nicht verschieben: Nur bei einer entfernten Option oder Eigenschaft gibt es Werte dafür.`,
        ),
        hint: 'Choose "Discard the values" for this change.',
      });
      continue;
    }
    const p = payloadOf(path, removed, m.to, file);
    if ('code' in p) problems.push(p);
    else moves.push({ path, payload: p });
  }
  return { moves, problems };
}

/** Writes one row per move; call inside the deploy transaction. */
export function recordMoves(db: Db, version: number, moves: PlannedMoves['moves']): void {
  const put = db.prepare('INSERT INTO deploy_moves (version, path, payload) VALUES (?, ?, ?)');
  for (const m of moves) put.run(version, m.path, JSON.stringify(m.payload));
}

/**
 * One `$recompute` move per type with a computed property that is new or whose expression changed (WP-312), recorded at
 * the first such property. Nothing is recorded without a deployed version: no feature exists yet.
 */
export function recomputeMoves(before: TemplateFile | undefined, after: TemplateFile): PlannedMoves['moves'] {
  if (before === undefined) return [];
  const out: { path: string; payload: MovePayload }[] = [];
  for (const [type, t] of Object.entries(after.types ?? {})) {
    const changed = Object.entries(t.properties).find(
      ([key, p]) =>
        p.computed !== undefined && p.computed !== before.types?.[type]?.properties[key]?.computed,
    );
    if (changed !== undefined)
      out.push({
        path: formatKeyPath(['types', type, 'properties', changed[0], 'computed']),
        payload: { type, recompute: true },
      });
  }
  return out;
}

/**
 * The `{ to }` mappings a deploy recorded for `version`, as they were given (WP-373): path to `{ to }`. The preview
 * carries its data over with exactly these (A-034), so the preview's moves and the live ones cannot drift (R1).
 */
export function recordedMappings(db: Db, version: number): Record<string, ValueMapping> {
  const out: Record<string, ValueMapping> = {};
  const rows = db
    .prepare<{ path: string; payload: string }>(
      'SELECT path, payload FROM deploy_moves WHERE version = ? ORDER BY id',
    )
    .all(version);
  for (const r of rows) {
    const move = JSON.parse(r.payload) as MovePayload;
    if ('to' in move) out[r.path] = { to: move.to };
    else if ('to_property' in move) out[r.path] = { to: move.to_property };
  }
  return out;
}
