import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { openProjectDb } from '../db/open';
import { deploy, plan, loadConfig, versions, indexName, noCaseIndexName } from './index';

const clock = { now: () => '2026-09-29T10:00:00Z' };
const deps = { clock };

const base: TemplateFile = {
  schema: 'ueberblick/1',
  template: { key: 'demo', version: '1.0.0' },
  types: {
    baum: {
      label: 'Baum',
      geometry: 'point',
      properties: {
        art: { type: 'text', index: true },
        vitalitaet: { type: 'integer', min: 0, max: 5 },
      },
    },
  },
  tasks: { melden: { label: 'Melden', on: 'baum', form: { art: {} } } },
};
/** A mutable view of `base` so specs can edit it without assertions. */
interface Editable {
  types: {
    baum: {
      label: string;
      properties: { art: { index?: boolean }; vitalitaet: { index?: boolean; max: number } };
    };
  };
  tasks: { melden: { on: string } };
}
const edit = (fn: (f: Editable) => void): TemplateFile => {
  const c = structuredClone(base);
  fn(c as unknown as Editable);
  return c;
};
const broken = (extra?: (f: Editable) => void): TemplateFile =>
  edit((f) => {
    f.tasks.melden.on = 'gibtsnicht';
    extra?.(f);
  });
const indexes = (db: ReturnType<typeof openProjectDb>): string[] =>
  db
    .prepare<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'cfg_idx_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);

describe('deploy', () => {
  it('blocks a file with compile problems and reports paths', () => {
    const db = openProjectDb(':memory:', 'p');
    const r = deploy(db, broken(), 'admin-1', deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.every((p) => p.path.length > 0)).toBe(true);
    if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
    expect(versions(db)).toHaveLength(0);
    expect(plan(db, broken(), deps).ok).toBe(false);
  });

  it('stores version 1 as deployed with author, time and hash', () => {
    const db = openProjectDb(':memory:', 'p');
    const r = deploy(db, base, 'admin-1', deps);
    if (!r.ok) throw new Error('expected ok');
    expect(r.version).toBe(1);
    expect(r.created).toBe(true);
    expect(r.diff.some((d) => d.path === 'types' && d.change === 'added')).toBe(true);
    const [v] = versions(db);
    expect(v).toMatchObject({
      version: 1,
      status: 'deployed',
      createdBy: 'admin-1',
      template: 'demo',
      templateVersion: '1.0.0',
      createdAt: '2026-09-29T10:00:00Z',
    });
  });

  it('the same file twice gives the same hash and no new version', () => {
    const db = openProjectDb(':memory:', 'p');
    const a = deploy(db, base, 'a', deps);
    const b = deploy(db, structuredClone(base), 'a', deps);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(b.version).toBe(a.version);
    expect(b.created).toBe(false);
    expect(b.diff).toEqual([]);
    expect(versions(db)).toHaveLength(1);
  });

  it('a changed file creates version 2 and retires version 1', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(db, base, 'a', deps);
    const next = edit((f) => void (f.types.baum.properties.vitalitaet.max = 9));
    const p = plan(db, next, deps);
    expect(p.ok && p.diff.map((d) => d.path)).toEqual(['types.baum.properties.vitalitaet.max']);
    expect(versions(db)).toHaveLength(1); // plan is a dry run
    const r = deploy(db, next, 'b', deps);
    if (!r.ok) throw new Error('expected ok');
    expect(r.version).toBe(2);
    expect(versions(db).map((v) => v.status)).toEqual(['retired', 'deployed']);
  });

  it('redeploying an older file reactivates its version instead of duplicating', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(db, base, 'a', deps);
    deploy(
      db,
      edit((f) => void (f.types.baum.label = 'Baum2')),
      'a',
      deps,
    );
    const r = deploy(db, base, 'a', deps);
    if (!r.ok) throw new Error('expected ok');
    expect(r).toMatchObject({ version: 1, created: false });
    expect(versions(db).map((v) => v.status)).toEqual(['deployed', 'retired']);
  });

  it('old versions stay readable', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(db, base, 'a', deps);
    deploy(
      db,
      edit((f) => void (f.types.baum.label = 'Baum2')),
      'a',
      deps,
    );
    const v1 = loadConfig(db, 1);
    expect(v1?.file.types?.baum?.label).toBe('Baum');
    expect(loadConfig(db)?.file.types?.baum?.label).toBe('Baum2');
    expect(loadConfig(db, 99)).toBeUndefined();
    expect(v1?.expressions).toBeInstanceOf(Map);
  });

  it('recompiles from the stored file when the stored format is older', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(db, base, 'a', deps);
    const row = db
      .prepare<{ compiled: string }>('SELECT compiled FROM config_versions WHERE version = 1')
      .get();
    const stale = { ...JSON.parse(row?.compiled ?? '{}'), format: 0, expressions: [] };
    db.prepare('UPDATE config_versions SET compiled = ? WHERE version = 1').run(JSON.stringify(stale));
    expect(loadConfig(db, 1)?.file.types?.baum?.label).toBe('Baum');
  });
});

describe('index DDL', () => {
  it('creates indexes only for index: true and drops them when removed', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(db, base, 'a', deps);
    expect(indexes(db)).toEqual([indexName('baum', 'art'), noCaseIndexName('baum', 'art')].sort());
    const r = deploy(
      db,
      edit((f) => void (f.types.baum.properties.vitalitaet.index = true)),
      'a',
      deps,
    );
    expect(r.ok).toBe(true);
    expect(indexes(db)).toEqual(
      [indexName('baum', 'art'), noCaseIndexName('baum', 'art'), indexName('baum', 'vitalitaet')].sort(),
    );
    deploy(
      db,
      edit((f) => void delete f.types.baum.properties.art.index),
      'a',
      deps,
    );
    expect(indexes(db)).toEqual([]);
  });

  it('never touches platform indexes, and the planner uses the index', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(
      db,
      edit((f) => void delete f.types.baum.properties.art.index),
      'a',
      deps,
    );
    const names = db
      .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'")
      .all()
      .map((r) => r.name);
    expect(names).toContain('observations_by_feature');
    expect(names).toContain('edges_by_to');
    deploy(db, base, 'a', deps);
    const rows = db
      .prepare<{ detail: string }>(
        "EXPLAIN QUERY PLAN SELECT id FROM features WHERE type = 'baum' AND json_extract(properties, '$.art') = 'x'",
      )
      .all();
    expect(rows.map((p) => p.detail).join(' ')).toContain(indexName('baum', 'art'));
  });

  it('a blocked deploy leaves versions and indexes untouched', () => {
    const db = openProjectDb(':memory:', 'p');
    deploy(db, base, 'a', deps);
    const bad = broken((f) => void (f.types.baum.properties.vitalitaet.index = true));
    expect(deploy(db, bad, 'a', deps).ok).toBe(false);
    expect(indexes(db)).toEqual([indexName('baum', 'art'), noCaseIndexName('baum', 'art')].sort());
  });

  it('index names are unique per (type, property) (property test)', () => {
    const key = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
    fc.assert(
      fc.property(key, key, key, key, (t1, p1, t2, p2) => {
        fc.pre(t1 !== t2 || p1 !== p2);
        expect(indexName(t1, p1)).not.toBe(indexName(t2, p2));
      }),
    );
  });
});

describe('overlay projects', () => {
  const overlay: OverlayFile = {
    schema: 'ueberblick/1',
    extends: 'demo@1',
    add: { 'types.baum.properties.hoehe': { type: 'number', index: true } },
  };
  const templates = { resolve: (e: string) => (e === 'demo@1' ? base : undefined) };

  it('deploys an overlay through the same path and records base and overlay', () => {
    const db = openProjectDb(':memory:', 'p');
    const r = deploy(db, overlay, 'a', { ...deps, templates });
    if (!r.ok) throw new Error(JSON.stringify(r));
    const row = db
      .prepare<{ overlay: string; template: string; template_version: string }>(
        'SELECT * FROM config_versions',
      )
      .get();
    expect(JSON.parse(row?.overlay ?? 'null')).toEqual(overlay);
    expect([row?.template, row?.template_version]).toEqual(['demo', '1.0.0']);
    expect(indexes(db)).toContain(indexName('baum', 'hoehe'));
    expect(loadConfig(db)?.file.types?.baum?.properties.hoehe).toBeDefined();
  });

  it('reports a lock violation and an unknown template as problems', () => {
    const db = openProjectDb(':memory:', 'p');
    const locked = { ...base, lock: ['types.baum.properties.art'] };
    const bad: OverlayFile = { ...overlay, override: { 'types.baum.properties.art.type': 'integer' } };
    const r = deploy(db, bad, 'a', { ...deps, templates: { resolve: () => locked } });
    expect(!r.ok && r.problems.map((p) => p.code)).toContain('lock_violation');
    const none = deploy(db, overlay, 'a', { ...deps, templates: { resolve: () => undefined } });
    expect(!none.ok && none.problems[0]).toMatchObject({ path: 'extends', code: 'dangling_reference' });
    expect(deploy(db, overlay, 'a', deps).ok).toBe(false);
  });
});
