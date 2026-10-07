/**
 * The plan of a deploy (docs/08 "Diffs and deploys"): what changes against the running config
 * version. The entries are exactly `core.diff` (R1); this file only groups them, counts the features
 * of changed types and lists the mappings a breaking change needs. Pure, no DOM, no I/O.
 */
import {
  diff,
  isOrderOnly,
  parseKeyPath,
  type DiffEntry,
  type KeyPath,
  type TemplateFile,
} from '@ueberblick/core';

/** What to do with the data of something a breaking change removes or retypes. */
export type Mapping = { readonly to: string } | { readonly discard: true };

/** One breaking entry and the replacements the admin may choose (empty: only discarding is possible). */
export interface MappingRequest {
  readonly path: KeyPath;
  readonly choices: readonly string[];
}

/** The changes of one entity (`types.baum`), or of a top-level key that has no entity. */
export interface PlanEntity {
  readonly section: string;
  readonly entity: string | undefined;
  readonly path: KeyPath;
  readonly changes: readonly DiffEntry[];
}

export interface Plan {
  /** Equal to `diff(deployed, effective)`. */
  readonly entries: readonly DiffEntry[];
  readonly entities: readonly PlanEntity[];
  /** Features of each changed (not new) feature type; a type whose only change is `order_changed` is not in it. */
  readonly affected: readonly { readonly type: string; readonly features: number }[];
  readonly breaking: readonly DiffEntry[];
  readonly mappings: readonly MappingRequest[];
}

export interface PlanInput {
  /** The running config version's effective file; `undefined` before the first deploy. */
  readonly deployed: TemplateFile | undefined;
  readonly effective: TemplateFile;
  /** Number of features per feature type key. */
  readonly featureCounts: Readonly<Record<string, number>>;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value at `segments` of `file`, or undefined. */
function valueAt(file: unknown, segments: readonly string[]): unknown {
  let cur: unknown = file;
  for (const s of segments) {
    if (!isObj(cur)) return undefined;
    cur = cur[s];
  }
  return cur;
}

/** Keys of the map that holds `segments`' last key, without that key, in the new file. */
function siblings(after: TemplateFile, segments: readonly string[]): string[] {
  const map = valueAt(after, segments.slice(0, -1));
  const last = segments[segments.length - 1];
  return isObj(map) ? Object.keys(map).filter((k) => k !== last) : [];
}

function requestFor(entry: DiffEntry, after: TemplateFile): MappingRequest {
  const segments = parseKeyPath(entry.path) ?? [];
  // A changed value (a property's type) has no replacement; a removed key can be replaced by a sibling.
  return { path: entry.path, choices: entry.change === 'removed' ? siblings(after, segments) : [] };
}

export function buildPlan(input: PlanInput): Plan {
  const empty = { schema: input.effective.schema, template: input.effective.template };
  const entries = diff(input.deployed ?? empty, input.effective);
  const groups = new Map<string, { section: string; entity: string | undefined; changes: DiffEntry[] }>();
  for (const e of entries) {
    const segments = parseKeyPath(e.path) ?? [e.path];
    const [section = e.path, entity] = segments;
    const path = entity === undefined ? section : `${section}.${entity}`;
    const group = groups.get(path) ?? { section, entity, changes: [] };
    group.changes.push(e);
    groups.set(path, group);
  }
  const entities = [...groups].map(([path, g]): PlanEntity => ({ path, ...g }));
  const affected = entities
    .filter((e) => e.section === 'types' && e.entity !== undefined)
    // A reorder touches no feature (WP-401, A-042): a type with only `order_changed` entries is listed, not affected.
    .filter((e) => !isOrderOnly(e.changes))
    .filter(
      (e) => !(e.changes.length === 1 && e.changes[0]?.change === 'added' && e.changes[0].path === e.path),
    )
    .map((e) => ({ type: e.entity as string, features: input.featureCounts[e.entity as string] ?? 0 }));
  const breaking = entries.filter((e) => e.breaking);
  return {
    entries,
    entities,
    affected,
    breaking,
    mappings: breaking.map((e) => requestFor(e, input.effective)),
  };
}

const valid = (req: MappingRequest, m: Mapping | undefined): boolean =>
  m !== undefined && ('discard' in m ? m.discard : req.choices.includes(m.to));

/** The breaking entries that still have no valid mapping. */
export function missingMappings(
  plan: Plan,
  chosen: Readonly<Record<KeyPath, Mapping | undefined>>,
): KeyPath[] {
  return plan.mappings.filter((r) => !valid(r, chosen[r.path])).map((r) => r.path);
}

/** A deploy is possible once every breaking entry has a valid mapping. */
export const mappingsComplete = (
  plan: Plan,
  chosen: Readonly<Record<KeyPath, Mapping | undefined>>,
): boolean => missingMappings(plan, chosen).length === 0;
