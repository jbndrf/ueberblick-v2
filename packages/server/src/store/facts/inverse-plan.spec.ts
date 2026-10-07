import { describe, expect, it } from 'vitest';
import { SOURCES_SQL } from './facts';
import { openDb } from './sqlite.testkit';

/** `Facts.related` on an inverse relation (WP-358): the type filter must not make the planner scan every feature of that type. */
describe('inverse related read: query plan', () => {
  it('starts from the covering edges_by_to index, then probes the far feature by primary key', () => {
    const db = openDb();
    db.transaction(() => {
      const feature = db.prepare(
        `INSERT INTO features (id, type, config_version, properties, updated_seq, lifecycle) VALUES (?, ?, 1, '{}', 1, 'active')`,
      );
      const edge = db.prepare(
        `INSERT INTO edges (from_id, relation, to_id, derived, updated_seq) VALUES (?, 'plot', ?, 0, 1)`,
      );
      for (let p = 0; p < 50; p++) feature.run(`plot${p}`, 'plot');
      for (let t = 0; t < 3000; t++) {
        feature.run(`tree${t}`, 'tree');
        edge.run(`tree${t}`, `plot${t % 50}`);
      }
    });
    const plan = db
      .prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${SOURCES_SQL}`)
      .all('plot1', 'plot', 'tree')
      .map((r) => r.detail)
      .join(' | ');
    expect(plan).toMatch(/SEARCH e USING (COVERING )?INDEX edges_by_to/);
    expect(plan).toMatch(
      /SEARCH f USING (INDEX sqlite_autoindex_features_1|PRIMARY KEY|INTEGER PRIMARY KEY)/,
    );
    expect(plan).not.toMatch(/SEARCH f USING (COVERING )?INDEX features_by/);
    expect(plan).not.toContain('TEMP B-TREE');
    db.close();
  });
});
