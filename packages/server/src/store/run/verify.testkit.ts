/**
 * The invariant of the run transaction: `features`, `edges` and `feature_bbox` equal a from-scratch `core.fold` of
 * `observations`, with derived edges as a brute-force pass over all live features (no R*Tree, no incremental state).
 */
import {
  auditOf,
  createFold,
  edgeKey,
  type FeatureId,
  type FoldedFeature,
  type Geometry,
  type Json,
  type RecordedObservation,
  type RunId,
} from '@ueberblick/core';
import { foldSchema } from '@ueberblick/core/compile';
import { unionBbox } from '@ueberblick/core/geo/bbox';
import { auditFromRow } from '../facts/facts';
import type { Ctx } from './testkit';
import { isServed, type LifecycleState } from '@ueberblick/core';

const isGeometry = (v: Json | undefined): v is Json & Geometry =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as { type?: unknown }).type === 'string';

interface ObsRow {
  seq: number;
  run_id: string;
  feature_id: string;
  property: string;
  result: string | null;
  phenomenon_time: string | null;
  result_time: string | null;
}

export interface Mismatch {
  readonly what: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export function mismatches(ctx: Ctx, version = 1): Mismatch[] {
  const { db, config, deps } = ctx;
  const fold = createFold(deps.geo);
  const schema = foldSchema(config, version);
  const out: Mismatch[] = [];

  const byFeature = new Map<string, RecordedObservation[]>();
  for (const r of db.prepare<ObsRow>('SELECT * FROM observations ORDER BY seq').all()) {
    const list = byFeature.get(r.feature_id) ?? [];
    list.push({
      featureId: r.feature_id as FeatureId,
      property: r.property,
      result: (r.result === null ? null : JSON.parse(r.result)) as Json,
      seq: r.seq,
      runId: r.run_id as RunId,
      ...(r.phenomenon_time === null ? {} : { phenomenonTime: r.phenomenon_time }),
      ...(r.result_time === null ? {} : { resultTime: r.result_time }),
    });
    byFeature.set(r.feature_id, list);
  }

  const expected = new Map<string, FoldedFeature>();
  const references = new Set<string>();
  for (const [id, obs] of byFeature) {
    const r = fold.feature(undefined, obs, schema);
    if (r.feature === undefined) continue;
    expected.set(id, r.feature);
    for (const e of r.edges.put) references.add(edgeKey(e));
  }

  const rows = db
    .prepare<{
      id: string;
      type: string;
      properties: string;
      lifecycle: string;
      updated_seq: number;
      created_by: string | null;
      created_at: string | null;
      changed_at: string | null;
      pinned_version: number | null;
    }>(
      'SELECT id, type, properties, lifecycle, updated_seq, created_by, created_at, changed_at, pinned_version FROM features',
    )
    .all();
  if (rows.length !== expected.size)
    out.push({ what: 'feature count', expected: expected.size, actual: rows.length });
  for (const row of rows) {
    const f = expected.get(row.id);
    const actual = {
      type: row.type,
      properties: JSON.parse(row.properties) as Json,
      lifecycle: row.lifecycle as LifecycleState,
      updatedSeq: row.updated_seq,
      audit: auditFromRow(row),
      pin: row.pinned_version,
    };
    const want = f && {
      type: f.type,
      properties: f.properties,
      lifecycle: f.lifecycle,
      updatedSeq: f.updatedSeq,
      audit: auditOf(f),
      pin: f.pinnedVersion ?? null,
    };
    if (JSON.stringify(sortKeys(want)) !== JSON.stringify(sortKeys(actual)))
      out.push({ what: `feature ${row.id}`, expected: want, actual });
  }

  const storedEdges = db
    .prepare<{ from_id: string; relation: string; to_id: string; derived: number }>(
      'SELECT from_id, relation, to_id, derived FROM edges',
    )
    .all();
  const key = (e: { from_id: string; relation: string; to_id: string }): string =>
    `${e.from_id}\u0000${e.relation}\u0000${e.to_id}`;
  const storedRefs = new Set(storedEdges.filter((e) => e.derived === 0).map(key));
  if ([...references].sort().join('|') !== [...storedRefs].sort().join('|'))
    out.push({ what: 'reference edges', expected: [...references].sort(), actual: [...storedRefs].sort() });

  const derived = new Set<string>();
  for (const self of expected.values()) {
    if (!isServed(self.lifecycle)) continue;
    for (const rel of schema.types.get(self.type)?.derived ?? []) {
      if (rel.condition !== undefined) throw new Error('the brute-force check has no derive conditions');
      const a = self.properties[rel.selfProperty];
      if (!isGeometry(a)) continue;
      for (const other of expected.values()) {
        if (!isServed(other.lifecycle) || other.type !== rel.to || other.id === self.id) continue;
        const b = other.properties[rel.otherProperty];
        if (isGeometry(b) && deps.geo.test(rel.predicate, a, b))
          derived.add(edgeKey({ ...rel, from: self.id, to: other.id }));
      }
    }
  }
  const storedDerived = new Set(storedEdges.filter((e) => e.derived === 1).map(key));
  if ([...derived].sort().join('|') !== [...storedDerived].sort().join('|'))
    out.push({ what: 'derived edges', expected: [...derived].sort(), actual: [...storedDerived].sort() });

  const boxes = new Map(
    db
      .prepare<{ id: string; minx: number; maxx: number; miny: number; maxy: number }>(
        'SELECT f.id AS id, r.minx, r.maxx, r.miny, r.maxy FROM feature_bbox r JOIN features f ON f.rowid = r.rid',
      )
      .all()
      .map((b) => [b.id, [b.minx, b.miny, b.maxx, b.maxy]] as const),
  );
  for (const f of expected.values()) {
    const geoms = (schema.types.get(f.type)?.geometryProperties ?? [])
      .map((p) => f.properties[p])
      .filter(isGeometry)
      .map((g) => deps.geo.derive(g).bbox);
    const want = !isServed(f.lifecycle) ? undefined : unionBbox(geoms);
    const got = boxes.get(f.id);
    // R*Tree stores 32-bit floats, rounded outwards: compare with a tolerance, containment is what matters
    const same =
      want === undefined
        ? got === undefined
        : got !== undefined && want.every((v, i) => Math.abs(v - (got[i] as number)) < 1e-4);
    if (!same) out.push({ what: `bbox ${f.id}`, expected: want, actual: got });
  }
  if (
    boxes.size !==
    [...expected.values()].filter((f) => isServed(f.lifecycle) && hasGeometry(f, schema)).length
  )
    out.push({ what: 'bbox rows', expected: 'one per live geometry feature', actual: boxes.size });
  return out;
}

function hasGeometry(f: FoldedFeature, schema: ReturnType<typeof foldSchema>): boolean {
  return (schema.types.get(f.type)?.geometryProperties ?? []).some((p) => isGeometry(f.properties[p]));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  return v;
}
