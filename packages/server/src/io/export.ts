/**
 * GeoPackage export: one feature table per feature type, geometry as the standard blob in WGS84 (EPSG:4326, Z kept).
 *
 * Visibility is not decided here (R1): rows come through `sync.visible(actor, alias)`, the same predicate sync and the
 * OGC API use, and columns are cut to what `Perms.readable` allows the actor. The file is built in a temporary file
 * (bounded memory, one feature row in memory at a time) and streamed in chunks; it is removed when the stream ends.
 */
import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localize } from '@ueberblick/core/locale';
import {
  compilePerms,
  servedSql,
  type Actor,
  type CompiledConfig,
  type Geometry,
  type Json,
  type Key,
} from '@ueberblick/core';
import { openSqlite, type Db, type SqlValue } from '../db/driver';
import type { SyncService } from '../sync';
import { GPKG_APPLICATION_ID, GPKG_USER_VERSION, GPKG_SCHEMA, WGS84_WKT } from './gpkg-schema';
import { toGpkgBlob } from './wkb';

export interface ExportSource {
  /** The project database (read only here). */
  readonly db: Db;
  readonly config: CompiledConfig;
  /** Who exports: rows and columns are cut to what this actor may see. */
  readonly actor: Actor;
  /** `SyncService.visible`: the one row filter. */
  readonly visible: SyncService['visible'];
  readonly now: () => string;
}

const GEOMETRY_NAMES: Record<string, string> = {
  point: 'POINT',
  multipoint: 'MULTIPOINT',
  linestring: 'LINESTRING',
  multilinestring: 'MULTILINESTRING',
  polygon: 'POLYGON',
  multipolygon: 'MULTIPOLYGON',
  any: 'GEOMETRY',
};
const SQL_TYPE: Record<string, string> = { number: 'REAL', integer: 'INTEGER', boolean: 'INTEGER' };
const CHUNK = 64 * 1024;
const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

interface Column {
  readonly key: string;
  readonly type: string;
}

function attribute(type: string, v: Json | undefined): SqlValue {
  if (v === undefined || v === null) return null;
  if (type === 'boolean') return v === true ? 1 : 0;
  if (type === 'number' || type === 'integer') return typeof v === 'number' ? v : null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function writeLayer(out: Db, src: ExportSource, typeKey: Key, readable: ReadonlySet<string>): void {
  const type = src.config.file.types?.[typeKey];
  if (type === undefined) throw new Error(`unknown feature type "${typeKey}"`);
  const props = Object.entries(type.properties ?? {}).filter(([k]) => readable.has(k));
  const geomKey = type.geometry !== undefined && readable.has(type.geometry) ? type.geometry : undefined;
  const columns: Column[] = props.filter(([k]) => k !== geomKey).map(([k, p]) => ({ key: k, type: p.type }));
  const table = quote(typeKey);
  out.exec(
    `CREATE TABLE ${table} (_fid INTEGER PRIMARY KEY AUTOINCREMENT, _id TEXT NOT NULL${
      geomKey === undefined ? '' : `, ${quote(geomKey)} BLOB`
    }${columns.map((c) => `, ${quote(c.key)} ${SQL_TYPE[c.type] ?? 'TEXT'}`).join('')})`,
  );
  const label = type.label;
  const identifier = label === undefined ? typeKey : localize(label, ['de', 'en']);
  out
    .prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, srs_id)
       VALUES (?, ?, ?, '', ?, 4326)`,
    )
    .run(typeKey, geomKey === undefined ? 'attributes' : 'features', identifier, src.now());
  if (geomKey !== undefined) {
    const gt = type.properties?.[geomKey]?.geometry_type ?? 'any';
    out
      .prepare(
        'INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m) VALUES (?, ?, ?, 4326, 2, 0)',
      )
      .run(typeKey, geomKey, GEOMETRY_NAMES[gt] ?? 'GEOMETRY');
  }

  const vis = src.visible(src.actor, 'f');
  const names = [geomKey, ...columns.map((c) => c.key)].filter((k) => k !== undefined);
  const insert = out.prepare(
    `INSERT INTO ${table} (_id${names.map((n) => `, ${quote(n)}`).join('')}) VALUES (?${names.map(() => ', ?').join('')})`,
  );
  const rows = src.db
    .prepare<{ id: string; properties: string }>(
      `SELECT f.id AS id, f.properties AS properties FROM features f
       WHERE f.type = ? AND ${servedSql('f.lifecycle')} AND ${vis.sql} ORDER BY f.rowid`,
    )
    .iterate(typeKey, ...(vis.params as SqlValue[]));
  out.transaction(() => {
    for (const r of rows) {
      const p = JSON.parse(r.properties) as Record<string, Json>;
      const g = geomKey === undefined ? undefined : (p[geomKey] as Geometry | null | undefined);
      const values: SqlValue[] = [r.id];
      if (geomKey !== undefined) values.push(g ? toGpkgBlob(g, 4326) : null);
      for (const c of columns) values.push(attribute(c.type, p[c.key]));
      insert.run(...values);
    }
  });
}

/** Build the GeoPackage of `types` in a temporary directory; returns its path and a cleanup. */
export function buildGpkg(src: ExportSource, types: readonly Key[]): { path: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ueberblick-export-'));
  const path = join(dir, 'export.gpkg');
  const dispose = (): void => rmSync(dir, { recursive: true, force: true });
  try {
    const out = openSqlite(path);
    try {
      out.exec(`PRAGMA application_id = ${GPKG_APPLICATION_ID}; PRAGMA user_version = ${GPKG_USER_VERSION};`);
      out.exec(GPKG_SCHEMA);
      out
        .prepare(
          "INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84 geodetic', 4326, 'EPSG', 4326, ?, 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid')",
        )
        .run(WGS84_WKT);
      const perms = compilePerms(src.config);
      const subjects = perms.subjects(src.actor);
      for (const t of types) writeLayer(out, src, t, perms.forType(t)?.readable(subjects) ?? new Set());
      out.exec('PRAGMA journal_mode = DELETE'); // no -wal side file in a delivered GeoPackage
    } finally {
      out.close();
    }
    return { path, dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}

/** `exportGpkg(types) -> stream` of the GeoPackage bytes. Building starts with the first read. */
export async function* exportGpkg(src: ExportSource, types: readonly Key[]): AsyncGenerator<Uint8Array> {
  const built = buildGpkg(src, types);
  try {
    for await (const chunk of createReadStream(built.path, { highWaterMark: CHUNK }))
      yield chunk as Uint8Array;
  } finally {
    built.dispose();
  }
}
