/**
 * Direct row inserts into a project DB (WP-100 schema). Until the run store exists (WP-104) the generator
 * writes runs, observations and folded rows itself; it will switch to runs then. Every inserted value feeds
 * a digest, so "same seed, same data" is checkable without reading the database back.
 */
import { createHash, type Hash } from 'node:crypto';
import type { Db, SqlValue, Stmt } from '../../packages/server/src';

export interface ObservationIn {
  readonly featureId: string;
  readonly property: string;
  readonly result: unknown;
}

export interface FeatureIn {
  readonly id: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
  readonly geometry?: {
    readonly json: string;
    readonly anchor: readonly [number, number];
    readonly areaM2: number;
  };
  readonly bbox?: readonly [number, number, number, number];
}

const FIXED_CONFIG_VERSION = 1;

export function createWriter(db: Db) {
  const hash: Hash = createHash('sha256');
  const stmt = (sql: string): Stmt<never> => db.prepare<never>(sql);
  const s = {
    participant: stmt('INSERT INTO participants (id, name, roles) VALUES (?, ?, ?)'),
    run: stmt(
      `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, seq)
       VALUES (?, ?, ?, ?, ?, '{}', ?, 'accepted', ?)`,
    ),
    obs: stmt(
      'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    feature: stmt(
      `INSERT INTO features (id, type, config_version, properties, geometry, anchor_lon, anchor_lat, area_m2, updated_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    bbox: stmt('INSERT INTO feature_bbox (rid, minx, maxx, miny, maxy) VALUES (?, ?, ?, ?, ?)'),
    edge: stmt('INSERT INTO edges (from_id, relation, to_id, derived, updated_seq) VALUES (?, ?, ?, 1, ?)'),
  };
  const put = (st: Stmt<never>, ...params: SqlValue[]) => {
    hash.update(JSON.stringify(params));
    return st.run(...params);
  };
  let seq = 0;

  return {
    configVersion: FIXED_CONFIG_VERSION,
    /** Runs `fn(i)` for i in [0, n) in transactions of `size` rows. */
    batch(n: number, size: number, fn: (i: number) => void): void {
      for (let from = 0; from < n; from += size)
        db.transaction(() => {
          for (let i = from; i < Math.min(n, from + size); i++) fn(i);
        });
    },
    config(template: string, sha: string): void {
      put(
        stmt(
          `INSERT INTO config_versions (version, schema, template, template_version, overlay, compiled, hash, status, created_by, created_at)
           VALUES (?, 'ueberblick/1', ?, ?, '{}', '{}', ?, 'deployed', 'bench', '2026-01-01T00:00:00.000Z')`,
        ),
        FIXED_CONFIG_VERSION,
        template.split('@')[0] ?? template,
        template.split('@')[1] ?? '',
        sha,
      );
    },
    participant: (id: string, name: string, roles: readonly string[]) =>
      void put(s.participant, id, name, JSON.stringify(roles)),
    /** One accepted run with its observations; returns the last seq it used. */
    run(
      id: string,
      actor: { id: string; kind: string },
      task: string,
      at: string,
      observations: readonly ObservationIn[],
    ): number {
      const first = seq + 1;
      seq += observations.length;
      put(s.run, id, actor.id, actor.kind, task, FIXED_CONFIG_VERSION, at, seq);
      observations.forEach((o, k) =>
        put(s.obs, first + k, id, o.featureId, o.property, JSON.stringify(o.result), at),
      );
      return seq;
    },
    /** The folded row. `updatedSeq` is the last seq that touched the feature. */
    feature(f: FeatureIn, updatedSeq: number): void {
      const g = f.geometry;
      const res = put(
        s.feature,
        f.id,
        f.type,
        FIXED_CONFIG_VERSION,
        JSON.stringify(f.properties),
        g?.json ?? null,
        g?.anchor[0] ?? null,
        g?.anchor[1] ?? null,
        g?.areaM2 ?? null,
        updatedSeq,
      );
      if (f.bbox) put(s.bbox, Number(res.lastInsertRowid), f.bbox[0], f.bbox[2], f.bbox[1], f.bbox[3]);
    },
    derivedEdge: (from: string, relation: string, to: string, updatedSeq: number) =>
      void put(s.edge, from, relation, to, updatedSeq),
    digest: () => hash.copy().digest('hex'),
  };
}

export type Writer = ReturnType<typeof createWriter>;
