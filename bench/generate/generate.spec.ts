import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src';
import { generate } from './generate';

/** Every table, every row, in a fixed order: the byte-level identity of a generated database. */
function dump(db: Db): string {
  const h = createHash('sha256');
  const tables = ['config_versions', 'participants', 'runs', 'observations', 'features', 'edges'];
  for (const t of tables)
    for (const row of db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).iterate()) h.update(JSON.stringify(row));
  for (const row of db.prepare('SELECT * FROM feature_bbox ORDER BY rid').iterate())
    h.update(JSON.stringify(row));
  return h.digest('hex');
}

describe('generate (small)', () => {
  const a = generate({ seed: 7, features: 3000 });
  const b = generate({ seed: 7, features: 3000 });
  const c = generate({ seed: 8, features: 3000 });

  it('same seed gives byte-identical data', () => {
    expect(a.digest).toBe(b.digest);
    expect(dump(a.db)).toBe(dump(b.db));
    expect(c.digest).not.toBe(a.digest);
    expect(dump(c.db)).not.toBe(dump(a.db));
  });

  it('follows the spec: counts, history, assignment, edges', () => {
    const count = (sql: string) => a.db.prepare<{ n: number }>(sql).get()?.n ?? -1;
    expect(count('SELECT count(*) n FROM features')).toBe(3000);
    expect(a.stats.byType.baum).toBe(2600);
    expect(count("SELECT count(*) n FROM features WHERE type = 'flaeche'")).toBe(40);
    expect(count('SELECT count(*) n FROM participants')).toBe(40);
    expect(count('SELECT count(*) n FROM observations')).toBeGreaterThan(3000 * 3);
    expect(count('SELECT count(*) n FROM feature_bbox')).toBe(2640);
    const assigned = count(
      "SELECT count(*) n FROM features WHERE type = 'baum' AND json_extract(properties, '$.zustaendig') IS NOT NULL",
    );
    expect(assigned / 2600).toBeGreaterThan(0.2);
    expect(assigned / 2600).toBeLessThan(0.3);
    expect(a.stats.derivedShare).toBeGreaterThan(0.4);
    expect(a.stats.derivedShare).toBeLessThan(0.9);
    expect(count("SELECT count(*) n FROM edges WHERE derived = 1 AND relation = 'flaeche'")).toBeGreaterThan(
      0,
    );
  });

  it('folded rows equal the last observation per property (current-value rule)', () => {
    const row = a.db
      .prepare<{ id: string; properties: string }>(
        "SELECT id, properties FROM features WHERE type = 'baum' AND json_extract(properties, '$.befund') IS NOT NULL LIMIT 1",
      )
      .get();
    const last = a.db
      .prepare<{ result: string }>(
        "SELECT result FROM observations WHERE feature_id = ? AND property = 'befund' ORDER BY seq DESC LIMIT 1",
      )
      .get(row?.id ?? '');
    expect(JSON.stringify(JSON.parse(row?.properties ?? '{}').befund)).toBe(last?.result);
  });

  it('H1: some geometries carry Z', () => {
    const z = a.db
      .prepare<{ n: number }>(
        "SELECT count(*) n FROM features WHERE type = 'baum' AND json_array_length(json_extract(geometry, '$.coordinates')) = 3",
      )
      .get();
    expect(z?.n).toBeGreaterThan(0);
  });
});

describe('generate (60k)', () => {
  it('60,000 features in under 60 s and under 500 MB', () => {
    const t0 = Date.now();
    const g = generate({ seed: 4711, features: 60_000 });
    const ms = Date.now() - t0;
    const rssMb = process.memoryUsage().rss / 1024 / 1024;
    console.log(`generate 60k: ${ms} ms, rss ${Math.round(rssMb)} MB, ${JSON.stringify(g.stats)}`);
    expect(g.db.prepare<{ n: number }>('SELECT count(*) n FROM features').get()?.n).toBe(60_000);
    expect(ms).toBeLessThan(60_000);
    expect(rssMb).toBeLessThan(500);
  });
});
