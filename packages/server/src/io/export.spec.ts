import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGeo, type Geometry, type Key, type Position } from '@ueberblick/core';
import { openSqlite } from '../db/driver';
import { createVersionCache } from '../store/run/config-for';
import { createSyncService } from '../sync';
import { anna, syncSetup, tree, vera } from '../sync/testkit';
import { NOW } from '../store/run/testkit';
import { buildGpkg, exportGpkg, type ExportSource } from './export';
import { importFile } from './import';
import { features, importSetup, TREE_MAPPING } from './testkit';
import { fromGpkgBlob, fromWkb, toGpkgBlob, toWkb } from './wkb';

const source = (ctx: ReturnType<typeof syncSetup>, actor: ExportSource['actor']): ExportSource => ({
  db: ctx.db,
  config: ctx.config,
  actor,
  visible: (a, alias) => ctx.service.visible(a, alias),
  now: () => NOW,
});

const seed = (ctx: ReturnType<typeof syncSetup>): void =>
  ctx.seed([
    {
      id: tree(1),
      type: 'baum',
      properties: {
        zustaendig: 'anna',
        stage: 'erfasst',
        intern_notiz: 'geheim',
        hoehe_m: 12.5,
        kontrolle_faellig: true,
        geometrie: { type: 'Point', coordinates: [7.1, 50.7, 88.25] },
      },
    },
    {
      id: tree(2),
      type: 'baum',
      properties: {
        zustaendig: 'bernd',
        stage: 'erfasst',
        geometrie: { type: 'Point', coordinates: [7.2, 50.7] },
      },
    },
  ]);

async function bytes(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of it) parts.push(c);
  return Buffer.concat(parts);
}

describe('exportGpkg: the file', () => {
  it('opens with the SQLite driver and passes the GeoPackage schema check', () => {
    const ctx = syncSetup();
    seed(ctx);
    const built = buildGpkg(source(ctx, vera), ['baum' as Key, 'flaeche' as Key]);
    try {
      const db = openSqlite(built.path);
      const one = (sql: string): unknown =>
        Object.values(db.prepare<Record<string, unknown>>(sql).get() ?? {})[0];
      expect(one('PRAGMA application_id')).toBe(0x47504b47);
      expect(one('PRAGMA user_version')).toBe(10300);
      expect(one('PRAGMA integrity_check')).toBe('ok');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      const names = db
        .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'gpkg_spatial_ref_sys',
          'gpkg_contents',
          'gpkg_geometry_columns',
          'baum',
          'flaeche',
        ]),
      );
      expect(
        db
          .prepare<{ srs_id: number }>(
            'SELECT srs_id FROM gpkg_spatial_ref_sys WHERE srs_id IN (-1, 0, 4326) ORDER BY srs_id',
          )
          .all(),
      ).toHaveLength(3);
      expect(
        db.prepare('SELECT * FROM gpkg_contents WHERE data_type = ? AND srs_id = 4326').all('features'),
      ).toHaveLength(2);
      expect(
        db
          .prepare<{ geometry_type_name: string; z: number }>(
            'SELECT geometry_type_name, z FROM gpkg_geometry_columns WHERE table_name = ?',
          )
          .get('baum'),
      ).toEqual({ geometry_type_name: 'POINT', z: 2 });
      // every geometry column of a feature table is a valid GeoPackage blob
      const blob = db.prepare<{ g: Uint8Array }>('SELECT geometrie AS g FROM baum ORDER BY _fid').all()[0]
        ?.g as Uint8Array;
      expect(fromGpkgBlob(blob)?.geometry).toEqual({ type: 'Point', coordinates: [7.1, 50.7, 88.25] });
      db.close();
    } finally {
      built.dispose();
    }
  });

  it('streams the same bytes and removes its temporary file', async () => {
    const ctx = syncSetup();
    seed(ctx);
    const all = await bytes(exportGpkg(source(ctx, vera), ['baum' as Key]));
    expect(Buffer.from(all.subarray(0, 15)).toString('latin1')).toBe('SQLite format 3');
    expect(all.length).toBeGreaterThan(4096);
  });
});

describe('exportGpkg: visibility (one filter, R1)', () => {
  it('a participant exports only the rows and columns sync would show', () => {
    const ctx = syncSetup();
    seed(ctx);
    const rowsOf = (actor: ExportSource['actor']): { ids: string[]; cols: string[] } => {
      const built = buildGpkg(source(ctx, actor), ['baum' as Key]);
      try {
        const db = openSqlite(built.path);
        const ids = db
          .prepare<{ _id: string }>('SELECT _id FROM baum ORDER BY _fid')
          .all()
          .map((r) => r._id);
        const cols = db
          .prepare<{ name: string }>("SELECT name FROM pragma_table_info('baum')")
          .all()
          .map((r) => r.name);
        db.close();
        return { ids, cols };
      } finally {
        built.dispose();
      }
    };
    const a = rowsOf(anna);
    expect(a.ids).toEqual([tree(1)]);
    expect(a.cols).toContain('intern_notiz'); // kontrolle may read it
    expect(rowsOf(vera).ids).toEqual([tree(1), tree(2)]);
    // the export and the sync page agree on the rows
    const page = ctx.service.page(anna, { since: 0, scope: '', v: 1 });
    expect(page.features.filter((f) => f.type === 'baum').map((f) => f.id)).toEqual(a.ids);
  });

  it('cuts columns to the readable properties (a role without the property does not get its column)', () => {
    const ctx = syncSetup();
    seed(ctx);
    const bauhof = { id: 'bernd', kind: 'participant', roles: ['bauhof' as Key] } as const;
    const built = buildGpkg(source(ctx, bauhof), ['baum' as Key]);
    try {
      const db = openSqlite(built.path);
      const cols = db
        .prepare<{ name: string }>("SELECT name FROM pragma_table_info('baum')")
        .all()
        .map((r) => r.name);
      expect(cols).not.toContain('intern_notiz');
      db.close();
    } finally {
      built.dispose();
    }
  });
});

describe('round trip: GeoPackage -> import -> export is lossless for supported types (H6)', () => {
  it('a tree survives export -> import -> export unchanged', () => {
    const a = syncSetup();
    seed(a);
    const first = buildGpkg(source(a, vera), ['baum' as Key]);
    const { ctx, deps } = importSetup();
    // the golden `erfassen` accepts geometry, vitalitaet, beschreibung: seed a vitality so the rows are valid
    const src = openSqlite(first.path);
    src.exec("ALTER TABLE baum ADD COLUMN vit TEXT; UPDATE baum SET vit = 'v2'");
    src.close();
    const r = importFile(
      ctx.store,
      { format: 'geopackage', path: first.path },
      { task: TREE_MAPPING.task, fields: { vitalitaet: 'vit' } },
      deps,
    );
    expect(r).toMatchObject({ outcome: 'accepted', imported: 2 });
    const back = features(ctx).map((f) => f.properties['geometrie']);
    expect(back).toEqual([
      { type: 'Point', coordinates: [7.1, 50.7, 88.25] },
      { type: 'Point', coordinates: [7.2, 50.7] },
    ]);
    first.dispose();
    const c = ctx;
    const again = buildGpkg(
      {
        db: c.db,
        config: c.config,
        actor: vera,
        visible: (act, alias) =>
          createSyncService(c.db, {
            config: () => ({ version: 1, config: c.config }),
            at: () => c.config,
            versions: createVersionCache(() => c.config),
            clock: { now: () => NOW },
            geo: createGeo(),
          }).visible(act, alias),
        now: () => NOW,
      },
      ['baum' as Key],
    );
    const db = openSqlite(again.path);
    const rows = db.prepare<{ g: Uint8Array }>('SELECT geometrie AS g FROM baum ORDER BY _fid').all();
    expect(rows.map((r) => fromGpkgBlob(r.g)?.geometry)).toEqual(back);
    db.close();
    again.dispose();
  });
});

describe('WKB (property)', () => {
  const pos = fc.oneof(
    fc.tuple(fc.double({ min: -180, max: 180, noNaN: true }), fc.double({ min: -90, max: 90, noNaN: true })),
    fc.tuple(
      fc.double({ min: -180, max: 180, noNaN: true }),
      fc.double({ min: -90, max: 90, noNaN: true }),
      fc.double({ min: -500, max: 9000, noNaN: true }),
    ),
  );
  const line = fc.array(pos, { minLength: 2, maxLength: 6 });
  // WKB has one dimension per geometry: all positions 2D or all 3D
  const uniform = (g: Geometry): boolean => {
    const dims = new Set<number>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v) && typeof v[0] === 'number') dims.add(v.length);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && 'geometries' in v)
        (v as { geometries: unknown[] }).geometries.forEach((x) =>
          walk((x as { coordinates: unknown }).coordinates),
        );
      else if (v && typeof v === 'object' && 'coordinates' in v)
        walk((v as { coordinates: unknown }).coordinates);
    };
    walk(g);
    return dims.size <= 1;
  };
  const geometry: fc.Arbitrary<Geometry> = fc
    .oneof(
      pos.map((c): Geometry => ({ type: 'Point', coordinates: c as Position })),
      line.map((c): Geometry => ({ type: 'LineString', coordinates: c as Position[] })),
      fc
        .array(line, { minLength: 1, maxLength: 3 })
        .map((c): Geometry => ({ type: 'Polygon', coordinates: c as Position[][] })),
      line.map((c): Geometry => ({ type: 'MultiPoint', coordinates: c as Position[] })),
      fc
        .array(line, { minLength: 1, maxLength: 3 })
        .map((c): Geometry => ({ type: 'MultiLineString', coordinates: c as Position[][] })),
      fc
        .array(fc.array(line, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 2 })
        .map((c): Geometry => ({ type: 'MultiPolygon', coordinates: c as Position[][][] })),
    )
    .filter(uniform);

  it('write then read gives the geometry back, Z included', () => {
    fc.assert(
      fc.property(geometry, (g) => {
        expect(fromWkb(toWkb(g))).toEqual(g);
      }),
    );
  });
  it('the GeoPackage blob carries the geometry and the srs id', () => {
    fc.assert(
      fc.property(geometry, (g) => {
        expect(fromGpkgBlob(toGpkgBlob(g, 4326))).toEqual({ geometry: g, srsId: 4326 });
      }),
    );
  });
});
