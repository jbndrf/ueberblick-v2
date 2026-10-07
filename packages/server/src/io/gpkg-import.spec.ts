import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Geometry } from '@ueberblick/core';
import { openSqlite } from '../db/driver';
import { setup } from '../store/run/testkit';
import { GPKG_SCHEMA } from './gpkg-schema';
import { importFile, planImport } from './import';
import { features, importSetup, TREE_MAPPING, importer } from './testkit';
import { toGpkgBlob } from './wkb';

const dir = mkdtempSync(join(tmpdir(), 'ueberblick-gpkg-spec-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A GeoPackage in EPSG:25832 with one tree layer, written with plain SQL like any other GIS would. */
function makeGpkg(
  name: string,
  srs: number | undefined,
  rows: readonly { vit: string; g: Geometry | null }[],
): string {
  const path = join(dir, name);
  rmSync(path, { force: true }); // a repeat (--repeats) would find the previous run's file
  const db = openSqlite(path);
  db.exec(GPKG_SCHEMA);
  db.exec(
    `INSERT INTO gpkg_spatial_ref_sys VALUES ('ETRS89 / UTM zone 32N', 25832, 'EPSG', 25832, 'undefined', NULL);
     CREATE TABLE baeume (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB, vit TEXT);
     INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES ('baeume', 'features', 'baeume', ${srs ?? 0});`,
  );
  db.exec(`INSERT INTO gpkg_geometry_columns VALUES ('baeume', 'geom', 'POINT', ${srs ?? 0}, 2, 0)`);
  const put = db.prepare('INSERT INTO baeume (geom, vit) VALUES (?, ?)');
  for (const r of rows) put.run(r.g ? toGpkgBlob(r.g, srs ?? 0) : null, r.vit);
  db.exec('PRAGMA journal_mode = DELETE');
  db.close();
  return path;
}

const mapping = { task: TREE_MAPPING.task, fields: { vitalitaet: 'vit' } } as const;
const point = (x: number, y: number, z?: number): Geometry => ({
  type: 'Point',
  coordinates: z === undefined ? [x, y] : [x, y, z],
});

describe('GeoPackage import', () => {
  it('reads the CRS from the srs row: EPSG:25832 with Z lands in 4326, Z kept', () => {
    const path = makeGpkg('utm.gpkg', 25832, [{ vit: 'v2', g: point(500000, 5538630.703, 77.5) }]);
    const { ctx, deps } = importSetup();
    expect(importFile(ctx.store, { format: 'geopackage', path }, mapping, deps)).toMatchObject({
      outcome: 'accepted',
      imported: 1,
    });
    const g = features(ctx)[0]?.properties['geometrie'] as { coordinates: number[] };
    expect(g.coordinates[0]).toBeCloseTo(9, 6);
    expect(g.coordinates[1]).toBeCloseTo(50, 5);
    expect(g.coordinates[2]).toBe(77.5);
  });

  it('accepts the file as bytes too', () => {
    const path = makeGpkg('bytes.gpkg', 25832, [{ vit: 'v1', g: point(500000, 5538630.7) }]);
    const { deps } = importSetup();
    const p = planImport({ format: 'geopackage', data: readFileSync(path) }, mapping, deps);
    expect(p.problems).toEqual([]);
    expect(p.runs).toHaveLength(1);
  });

  it('an undefined srs needs sourceCrs; a row without geometry reaches plan (geometry_required)', () => {
    const path = makeGpkg('nosrs.gpkg', undefined, [{ vit: 'v1', g: point(500000, 5538630.7) }]);
    const { ctx, deps } = importSetup();
    expect(importFile(ctx.store, { format: 'geopackage', path }, mapping, deps).outcome).toBe('refused');
    const ok = importFile(
      ctx.store,
      { format: 'geopackage', path },
      { ...mapping, sourceCrs: 'EPSG:25832' },
      deps,
    );
    expect(ok.outcome).toBe('accepted');
    const none = makeGpkg('nogeom.gpkg', 25832, [{ vit: 'v1', g: null }]);
    expect(importFile(ctx.store, { format: 'geopackage', path: none }, mapping, deps)).toMatchObject({
      outcome: 'refused',
      problems: [{ row: 1, code: 'geometry_required' }],
    });
  });

  it('a file that is not a GeoPackage is file_unreadable and leaves no temporary file behind', () => {
    const { deps } = importSetup();
    const p = planImport({ format: 'geopackage', data: Buffer.from('not sqlite at all') }, mapping, deps);
    expect(p.problems).toEqual([expect.objectContaining({ row: 0, code: 'file_unreadable' })]);
  });

  it('names a layer that does not exist', () => {
    const path = makeGpkg('layer.gpkg', 25832, []);
    const { deps } = importSetup();
    const p = planImport({ format: 'geopackage', path }, { ...mapping, layer: 'fehlt' }, deps);
    expect(p.problems[0]).toMatchObject({
      code: 'file_unreadable',
      message: expect.stringContaining('fehlt'),
    });
  });
});

describe('the doorbell and hooks fire for an import (imports are runs)', () => {
  it('runs the store hooks once per batch', () => {
    let calls = 0;
    const ctx = setup({ hooks: [() => void calls++] });
    const deps = {
      config: ctx.config,
      configVersion: 1,
      actor: importer,
      ids: ctx.deps.ids,
      geo: ctx.deps.geo,
    };
    importFile(
      ctx.store,
      { format: 'csv', data: 'vit;x;y\nv1;7;50\nv2;7.1;50' },
      { ...TREE_MAPPING, geometry: { field: 'geometrie', x: 'x', y: 'y' }, sourceCrs: 'EPSG:4326' },
      deps,
    );
    expect(calls).toBe(1);
  });
});
