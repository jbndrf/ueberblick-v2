/** Test support: the synthetic v3 data fixtures, a generator for large exports and a migration into an in-memory store. Not used at run time. */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { servedSql, type Clock } from '@ueberblick/core';
import { openProjectDb, type Db } from '@ueberblick/server';
import { convertConfig, type ConvertResult, type ImportTarget } from '../config';
import { loadFixture } from '../config/testing';
import { migrationStore, type MigrationStore } from './store';
import type { IdMap, V3DataExport } from './types';

export const NOW = '2026-05-01T08:00:00.000Z';
export const CLOCK: Clock = { now: () => NOW };

/** A synthetic v3 data export from `fixtures/v3-synthetic/data/<name>.yaml`. */
export function loadData(name: string): unknown {
  const url = new URL(`../../../../fixtures/v3-synthetic/data/${name}.yaml`, import.meta.url);
  return parse(readFileSync(url, 'utf8')) as unknown;
}

export interface World extends MigrationStore {
  readonly converted: ConvertResult;
  readonly target: ImportTarget;
  readonly db: Db;
}

/** The converted `baumkontrolle` project as an import project in a fresh in-memory project database. */
const prepared = new Map<string, { converted: ConvertResult; target: ImportTarget }>();

export function world(fixture = 'baumkontrolle'): World {
  let base = prepared.get(fixture);
  if (base === undefined) {
    const converted = convertConfig(loadFixture(fixture) as never, { target: 'import' });
    if (converted.target === undefined) throw new Error(`fixture ${fixture} has no import target`);
    base = { converted, target: converted.target };
    prepared.set(fixture, base);
  }
  const { converted, target } = base;
  const db = openProjectDb(':memory:', 'test');
  return { ...migrationStore(db, target, CLOCK), converted, target, db };
}

export interface FeatureRow {
  readonly type: string;
  readonly properties: Record<string, unknown>;
  readonly geometry: unknown;
  readonly anchor: readonly [number | null, number | null];
}

const round = (n: number | null): number | null => (n === null ? null : Math.round(n * 1e7) / 1e7);

/** Every live feature keyed by its v3 id; a value that is the id of another feature reads `@<v3 id>`. */
export function snapshot(db: Db, ids: IdMap): Record<string, FeatureRow> {
  const v3 = new Map<string, string>();
  for (const [k, id] of ids.entries()) v3.set(id, k);
  const rows = db
    .prepare<{
      id: string;
      type: string;
      properties: string;
      geometry: string | null;
      anchor_lon: number | null;
      anchor_lat: number | null;
    }>(
      `SELECT id, type, properties, geometry, anchor_lon, anchor_lat FROM features WHERE ${servedSql('lifecycle')}`,
    )
    .all();
  const out: Record<string, FeatureRow> = {};
  const swap = (v: unknown): unknown => (typeof v === 'string' && v3.has(v) ? `@${v3.get(v)}` : v);
  for (const r of rows) {
    const props = JSON.parse(r.properties) as Record<string, unknown>;
    out[v3.get(r.id) ?? r.id] = {
      type: r.type,
      properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, swap(v)])),
      geometry: r.geometry === null ? null : JSON.parse(r.geometry),
      anchor: [round(r.anchor_lon), round(r.anchor_lat)],
    };
  }
  return out;
}

/** Observations of one feature in order: property, value, phenomenon time. */
export function history(
  db: Db,
  feature: string,
): { property: string; result: unknown; time: string | null }[] {
  return db
    .prepare<{ property: string; result: string; phenomenon_time: string | null }>(
      'SELECT property, result, phenomenon_time FROM observations WHERE feature_id = ? ORDER BY seq',
    )
    .all(feature)
    .map((r) => ({ property: r.property, result: JSON.parse(r.result), time: r.phenomenon_time }));
}

/** A small deterministic pseudo-random sequence (no `Math.random`): the same export on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const iso = (ms: number): string => new Date(ms).toISOString().replace('T', ' ');
const T0 = Date.parse('2024-01-01T00:00:00.000Z');

/** What the generator promises for tree `i`: the final vitality label, the height and the position. */
export function expectedTree(i: number): {
  vitality: string;
  height: number;
  lon: number;
  lat: number;
  art: string | undefined;
} {
  const r = lcg(i + 1);
  const steps = 1 + (i % 3);
  let vitality = '0';
  for (let s = 0; s < steps; s++) vitality = String(Math.floor(r() * 5));
  return {
    vitality,
    height: 5 + (i % 40),
    lon: Number((7 + (i % 300) * 0.001).toFixed(7)),
    lat: Number((51 + Math.floor(i / 300) * 0.001).toFixed(7)),
    art: i % 3 === 0 ? (i % 2 === 0 ? 'Linde' : 'Eiche') : undefined,
  };
}

/**
 * `count` trees of the `baumkontrolle` fixture: one to three v3 runs each (vitality, height), a stage, a position
 * and, for every third tree, a species from the custom table. About 3.3 log rows and 2.3 runs per tree.
 */
export function syntheticExport(count: number): V3DataExport {
  const instances: V3DataExport['instances'][number][] = [];
  for (let i = 0; i < count; i++) {
    const e = expectedTree(i);
    const r = lcg(i + 1);
    const steps = 1 + (i % 3);
    const t = T0 + i * 60_000;
    const log: V3DataExport['instances'][number]['log'][number][] = [];
    for (let s = 0; s < steps; s++) {
      const at = iso(t + s * 3_600_000);
      const base = {
        observer: `u${i % 7}`,
        observedAt: at,
        recordedAt: at,
        run: `s${i}_${s}`,
      };
      log.push({ ...base, field: 'vitalitaet', value: String(Math.floor(r() * 5)) });
      if (s === 0) log.push({ ...base, field: 'hoehe_m', value: String(e.height) });
      if (s === 0 && e.art !== undefined) log.push({ ...base, field: 'art', value: e.art });
    }
    instances.push({
      id: `t${i}`,
      workflow: 'baum',
      status: 'active',
      stage: i % 2 === 0 ? 'erfasst' : 'kontrolliert',
      createdBy: `u${i % 7}`,
      createdAt: iso(t),
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      log,
    });
  }
  return {
    format: 1,
    users: [],
    instances,
    tableRows: [
      { id: 'art_linde', table: 'baumart', values: { name: 'Linde', hoehe_max: 40 } },
      { id: 'art_eiche', table: 'baumart', values: { name: 'Eiche', hoehe_max: 35 } },
    ],
  };
}
