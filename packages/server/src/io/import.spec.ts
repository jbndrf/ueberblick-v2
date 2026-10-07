import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import { importFile, planImport } from './import';
import { count, features, importSetup, TREE_MAPPING } from './testkit';

const CSV = (rows: string[]): string => ['vit;x;y;z', ...rows].join('\n');
const XY = { ...TREE_MAPPING, geometry: { field: 'geometrie', x: 'x', y: 'y' } } as const;
const CRS = { ...TREE_MAPPING, sourceCrs: 'EPSG:25832' } as const;

describe('CSV import: CRS', () => {
  it('EPSG:25832 lands in 4326 at the known position (central meridian 9 E, northing 5538630.7 = 50 N)', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(ctx.store, { format: 'csv', data: CSV(['v2;500000;5538630,703;']) }, CRS, deps);
    expect(r).toMatchObject({ outcome: 'accepted', imported: 1 });
    const g = features(ctx)[0]?.properties['geometrie'] as { coordinates: number[] };
    expect(g.coordinates[0]).toBeCloseTo(9, 6);
    expect(g.coordinates[1]).toBeCloseTo(50, 5);
  });

  it('keeps Z (H1) through reprojection, the run and the fold', () => {
    const { ctx, deps } = importSetup();
    importFile(ctx.store, { format: 'csv', data: CSV(['v2;500000;5538630.703;312.5']) }, CRS, deps);
    const g = features(ctx)[0]?.properties['geometrie'] as { coordinates: number[] };
    expect(g.coordinates).toHaveLength(3);
    expect(g.coordinates[2]).toBe(312.5);
  });

  it('refuses a file that does not declare its CRS (crs_undeclared), writing nothing', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(
      ctx.store,
      { format: 'csv', data: CSV(['v2;500000;5538630.7;']) },
      TREE_MAPPING,
      deps,
    );
    expect(r).toMatchObject({ outcome: 'refused', problems: [{ row: 0, code: 'crs_undeclared' }] });
    expect(count(ctx, 'runs')).toBe(0);
  });

  it('rejects coordinates outside the declared CRS (wrong CRS chosen)', () => {
    const { deps } = importSetup();
    const p = planImport(
      { format: 'csv', data: CSV(['v2;500000;5538630.7;']) },
      { ...TREE_MAPPING, sourceCrs: 'EPSG:4326' },
      deps,
    );
    expect(p.runs).toEqual([]);
    expect(p.problems[0]).toMatchObject({ row: 1, code: 'geometry_invalid' });
  });

  it('reads German decimal commas and a BOM', () => {
    const { ctx, deps } = importSetup();
    const data = `﻿${CSV(['v2;7,1;50,7;'])}`;
    importFile(ctx.store, { format: 'csv', data }, { ...TREE_MAPPING, sourceCrs: 'EPSG:4326' }, deps);
    expect((features(ctx)[0]?.properties['geometrie'] as { coordinates: number[] }).coordinates).toEqual([
      7.1, 50.7,
    ]);
  });
});

describe('modes: an invalid row', () => {
  const rows = ['v2;7.1;50.7;', 'v9;abc;50.7;', ';7.3;50.7;', 'v1;7.4;50.7;', 'v1;7.5'];
  const source = { format: 'csv', data: CSV(rows) } as const;
  const mapping = { ...TREE_MAPPING, sourceCrs: 'EPSG:4326' } as const;

  it('atomic (default) refuses everything with the row numbers and writes nothing', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(ctx.store, source, mapping, deps);
    expect(r.outcome).toBe('refused');
    expect(r.problems.map((p) => [p.row, p.code])).toEqual([
      [2, 'geometry_invalid'],
      [5, 'row_malformed'],
    ]);
    expect(count(ctx, 'features')).toBe(0);
    expect(count(ctx, 'runs')).toBe(0);
  });

  it('atomic: a plan refusal (required field missing) names its row and rolls the batch back', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(
      ctx.store,
      { format: 'csv', data: CSV(['v2;7.1;50.7;', ';7.3;50.7;']) },
      mapping,
      deps,
    );
    expect(r).toMatchObject({ outcome: 'refused', problems: [{ row: 2, code: 'required_missing' }] });
    expect(count(ctx, 'features')).toBe(0);
  });

  it('skip imports the good rows and reports the bad ones, plan refusals included', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(ctx.store, source, mapping, deps, { mode: 'skip' });
    expect(r.outcome).toBe('accepted');
    if (r.outcome === 'accepted') {
      expect(r.imported).toBe(2);
      expect(r.problems.map((p) => [p.row, p.code])).toEqual([
        [2, 'geometry_invalid'],
        [3, 'required_missing'],
        [5, 'row_malformed'],
      ]);
    }
    expect(features(ctx)).toHaveLength(2);
  });

  it('stops reading an atomic import after ATOMIC_PROBLEM_LIMIT problems', () => {
    const { deps } = importSetup();
    const many = Array.from({ length: 3000 }, () => 'v1;x;y;');
    const p = planImport({ format: 'csv', data: CSV(many) }, mapping, deps);
    expect(p.problems).toHaveLength(1000);
  });

  it('a file that is no CSV of the mapping is file_unreadable (row 0)', () => {
    const { deps } = importSetup();
    const p = planImport({ format: 'csv', data: 'vit;a;b\nv1;1;2' }, mapping, deps);
    expect(p.problems).toEqual([expect.objectContaining({ row: 0, code: 'file_unreadable' })]);
  });
});

describe('imports are runs (R3)', () => {
  it('writes runs of kind import through the store: ledger, hooks and rules included', () => {
    const { ctx, deps } = importSetup();
    importFile(
      ctx.store,
      { format: 'csv', data: CSV(['v2;7.1;50.7;', 'v3;7.2;50.7;']) },
      { ...TREE_MAPPING, sourceCrs: 'EPSG:4326' },
      deps,
    );
    const kinds = ctx.db
      .prepare<{ actor_kind: string; task: string }>('SELECT DISTINCT actor_kind, task FROM runs')
      .all();
    expect(kinds).toEqual([{ actor_kind: 'import', task: 'erfassen' }]);
    // the task's own step ran (faellig_am is set by `then`): the plan ran, not a row writer
    expect(features(ctx).every((f) => typeof f.properties['faellig_am'] === 'string')).toBe(true);
  });

  it('is one batch: one contiguous seq range', () => {
    const { ctx, deps } = importSetup();
    importFile(
      ctx.store,
      { format: 'csv', data: CSV(['v2;7.1;50.7;', 'v3;7.2;50.7;']) },
      { ...TREE_MAPPING, sourceCrs: 'EPSG:4326' },
      deps,
    );
    const seqs = ctx.db
      .prepare<{ seq: number }>('SELECT seq FROM observations ORDER BY seq')
      .all()
      .map((r) => r.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });
});

describe('text and mapping', () => {
  it('normalises imported text to NFC', () => {
    const { deps } = importSetup();
    const decomposed = 'Bäume';
    const p = planImport(
      { format: 'csv', data: `beschr;vit;x;y\n${decomposed};v1;7;50` },
      {
        ...XY,
        sourceCrs: 'EPSG:4326',
        fields: { vitalitaet: 'vit', beschreibung: { column: 'beschr', language: 'de' } },
      },
      deps,
    );
    expect(p.problems).toEqual([]);
    expect(p.runs[0]?.input['beschreibung']).toEqual({ de: 'Bäume' });
  });

  it('matches column names in NFC too', () => {
    const { deps } = importSetup();
    const p = planImport(
      { format: 'csv', data: 'vi\u0301t;x;y\nv1;7;50' },
      { ...XY, sourceCrs: 'EPSG:4326', fields: { vitalitaet: 'v\u00edt' } },
      deps,
    );
    expect(p.runs).toHaveLength(1);
  });

  it('refuses a mapping onto a task that does not create, or a field the task does not have', () => {
    const { deps } = importSetup();
    const a = planImport(
      { format: 'csv', data: CSV([]) },
      { ...TREE_MAPPING, task: 'kontrolle' as Key },
      deps,
    );
    expect(a.problems[0]?.code).toBe('mapping_invalid');
    const b = planImport(
      { format: 'csv', data: CSV([]) },
      { ...TREE_MAPPING, fields: { gibtsnicht: 'vit' } },
      deps,
    );
    expect(b.problems[0]?.code).toBe('mapping_invalid');
    const c = planImport(
      { format: 'csv', data: CSV([]) },
      { ...TREE_MAPPING, fields: { beschreibung: 'vit' } },
      deps,
    );
    expect(c.problems[0]?.message).toMatch(/language/);
  });
});

describe('GeoJSON import', () => {
  const fc = (crs: string | undefined, coords: number[]): string =>
    JSON.stringify({
      type: 'FeatureCollection',
      ...(crs ? { crs: { type: 'name', properties: { name: crs } } } : {}),
      features: [
        { type: 'Feature', properties: { vit: 'v2' }, geometry: { type: 'Point', coordinates: coords } },
      ],
    });
  const mapping = { task: TREE_MAPPING.task, fields: TREE_MAPPING.fields } as const;

  it('takes the CRS from the crs member and keeps Z', () => {
    const { ctx, deps } = importSetup();
    const data = fc('urn:ogc:def:crs:EPSG::25832', [500000, 5538630.703, 100]);
    expect(importFile(ctx.store, { format: 'geojson', data }, mapping, deps).outcome).toBe('accepted');
    const g = features(ctx)[0]?.properties['geometrie'] as { coordinates: number[] };
    expect(g.coordinates[0]).toBeCloseTo(9, 6);
    expect(g.coordinates[2]).toBe(100);
  });

  it('a file without a crs member is WGS84 (RFC 7946)', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(ctx.store, { format: 'geojson', data: fc(undefined, [7, 50]) }, mapping, deps);
    expect(r).toMatchObject({ outcome: 'accepted', imported: 1 });
    const g = features(ctx)[0]?.properties['geometrie'] as { coordinates: number[] };
    expect(g.coordinates).toEqual([7, 50]);
  });

  it('a declared crs the platform cannot reproject is still refused', () => {
    const { ctx, deps } = importSetup();
    const data = fc('urn:ogc:def:crs:EPSG::3857', [7, 50]);
    const r = importFile(ctx.store, { format: 'geojson', data }, mapping, deps);
    expect(r).toMatchObject({ outcome: 'refused', problems: [{ code: 'crs_undeclared' }] });
  });

  it('flags a malformed geometry by feature number', () => {
    const { deps } = importSetup();
    const data = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { vit: 'v1' }, geometry: { type: 'Point', coordinates: [7, 50] } },
        { type: 'Feature', properties: { vit: 'v1' }, geometry: { type: 'Point', coordinates: ['a', 50] } },
      ],
    });
    const p = planImport({ format: 'geojson', data }, { ...mapping, sourceCrs: 'EPSG:4326' }, deps);
    expect(p.problems).toEqual([expect.objectContaining({ row: 2, code: 'geometry_invalid' })]);
  });

  it('a geometry of the wrong kind for the property (a line for a point) is a problem', () => {
    const { deps } = importSetup();
    const data = JSON.stringify({
      type: 'Feature',
      properties: { vit: 'v1' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [7, 50],
          [7.1, 50.1],
        ],
      },
    });
    const p = planImport({ format: 'geojson', data }, { ...mapping, sourceCrs: 'EPSG:4326' }, deps);
    expect(p.problems[0]).toMatchObject({ row: 1, code: 'geometry_invalid' });
  });
});
