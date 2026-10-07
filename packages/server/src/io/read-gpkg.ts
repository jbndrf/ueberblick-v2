/** GeoPackage reader (OGC 12-128r18): one feature table, geometry from the standard blob, CRS from its srs row. */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GEO_SOURCE_CRS, type GeoSourceCrs, type Json } from '@ueberblick/core';
import { openSqlite, type Db } from '../db/driver';
import type { ImportMapping, ImportRow, ReadResult } from './contract';
import { ImportFileError } from './errors';
import { fromGpkgBlob } from './wkb';

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

interface Layer {
  readonly table: string;
  readonly geometryColumn: string | undefined;
  readonly srsId: number | undefined;
}

function crsOf(db: Db, srsId: number | undefined): GeoSourceCrs | undefined {
  if (srsId === undefined || srsId <= 0) return undefined;
  const r = db
    .prepare<{ org: string; id: number }>(
      'SELECT organization AS org, organization_coordsys_id AS id FROM gpkg_spatial_ref_sys WHERE srs_id = ?',
    )
    .get(srsId);
  const key = r ? `${r.org.toUpperCase()}:${r.id}` : undefined;
  return key !== undefined && GEO_SOURCE_CRS.has(key) ? key : undefined;
}

function findLayer(db: Db, name: string | undefined): Layer {
  const tables = db
    .prepare<{ table_name: string }>(
      "SELECT table_name FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name",
    )
    .all()
    .map((r) => r.table_name);
  const table = name ?? tables[0];
  if (table === undefined || !tables.includes(table)) {
    throw new ImportFileError(
      name === undefined ? 'the GeoPackage has no feature table' : `no feature table "${name}"`,
    );
  }
  const g = db
    .prepare<{ column_name: string; srs_id: number }>(
      'SELECT column_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?',
    )
    .get(table);
  return { table, geometryColumn: g?.column_name, srsId: g?.srs_id };
}

export function readGeoPackage(
  source: { readonly data: Uint8Array | string } | { readonly path: string },
  mapping: ImportMapping,
): ReadResult {
  const dir = mkdtempSync(join(tmpdir(), 'ueberblick-gpkg-'));
  const file = join(dir, 'in.gpkg');
  let db: Db | undefined;
  const dispose = (): void => {
    try {
      db?.close();
    } finally {
      db = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  };
  try {
    if ('path' in source) copyFileSync(source.path, file);
    else if (typeof source.data === 'string') throw new ImportFileError('a GeoPackage is binary, not text');
    else writeFileSync(file, source.data);
    db = openSqlite(file);
    const open = db;
    let layer: Layer;
    try {
      layer = findLayer(open, mapping.layer);
    } catch (e) {
      if (e instanceof ImportFileError) throw e;
      throw new ImportFileError('the file is not a GeoPackage');
    }
    const declared = crsOf(open, layer.srsId);
    const rows = (function* (): Generator<ImportRow> {
      let row = 0;
      const stmt = open.prepare<Record<string, unknown>>(
        `SELECT * FROM ${quote(layer.table)} ORDER BY rowid`,
      );
      for (const rec of stmt.iterate()) {
        row++;
        const values: Record<string, Json> = {};
        let geometry: ImportRow['geometry'];
        let bad: string | undefined;
        for (const [k, v] of Object.entries(rec)) {
          if (k === layer.geometryColumn) {
            if (v === null || v === undefined) continue;
            try {
              geometry = fromGpkgBlob(v as Uint8Array)?.geometry;
            } catch (e) {
              bad = (e as Error).message;
            }
          } else if (typeof v === 'bigint') values[k] = Number(v);
          else if (v === null || typeof v === 'string' || typeof v === 'number') values[k] = v;
        }
        yield bad !== undefined
          ? { row, values, problem: { code: 'geometry_invalid', message: bad } }
          : geometry
            ? { row, values, geometry }
            : { row, values };
      }
    })();
    return declared === undefined ? { rows, dispose } : { rows, declaredCrs: declared, dispose };
  } catch (e) {
    dispose();
    if (e instanceof ImportFileError) throw e;
    throw new ImportFileError(`cannot read the GeoPackage: ${(e as Error).message}`);
  }
}
