import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { openProjectDb } from '../db/open';
import { indexName, noCaseIndexName, wantedIndexes } from './index-ddl';

const file = (props: Record<string, { type: string }>): TemplateFile =>
  ({
    types: {
      baum: {
        properties: Object.fromEntries(Object.entries(props).map(([k, p]) => [k, { ...p, index: true }])),
      },
    },
  }) as unknown as TemplateFile;

describe('wantedIndexes: NOCASE twin', () => {
  it('emits a NOCASE index for text kinds only, beside the binary one', () => {
    const w = wantedIndexes(
      file({
        a: { type: 'text' },
        b: { type: 'select' },
        c: { type: 'number' },
        d: { type: 'boolean' },
        e: { type: 'date' },
      }),
    );
    for (const k of ['a', 'b', 'e']) {
      expect(w.get(indexName('baum', k))).not.toContain('NOCASE');
      expect(w.get(noCaseIndexName('baum', k))).toContain("'$." + k + "') COLLATE NOCASE, id)");
    }
    for (const k of ['c', 'd']) {
      expect(w.has(indexName('baum', k))).toBe(true);
      expect(w.has(noCaseIndexName('baum', k))).toBe(false);
    }
  });

  it('names never collide (property test)', () => {
    const key = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
    fc.assert(
      fc.property(key, key, key, key, (t1, p1, t2, p2) => {
        const names = [
          indexName(t1, p1),
          noCaseIndexName(t1, p1),
          indexName(t2, p2),
          noCaseIndexName(t2, p2),
        ];
        const same = t1 === t2 && p1 === p2;
        expect(new Set(names).size).toBe(same ? 2 : 4);
      }),
    );
  });

  it('the indexed text sort and the equality lookup each use an index', () => {
    const db = openProjectDb(':memory:', 'p');
    for (const sql of wantedIndexes(file({ befund: { type: 'text' } })).values()) db.exec(sql);
    const plan = (q: string) =>
      db
        .prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${q}`)
        .all()
        .map((r) => r.detail)
        .join(' | ');
    const sort = plan(
      `SELECT f.id FROM features f WHERE f.type = 'baum' AND f.lifecycle IN ('active') ORDER BY json_extract(f.properties, '$.befund') COLLATE NOCASE ASC, f.id ASC LIMIT 51`,
    );
    expect(sort).toContain(noCaseIndexName('baum', 'befund'));
    expect(sort).toBe(`SEARCH f USING INDEX ${noCaseIndexName('baum', 'befund')} (type=?)`);
    const eq = plan(
      `SELECT id FROM features WHERE type = 'baum' AND json_extract(properties, '$.befund') = 'x'`,
    );
    expect(eq).toContain(indexName('baum', 'befund'));
  });
});
