import { KeySchema, type CompiledConfig } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/driver';
import type { FeaturePage } from './index';
import { ids, insert, world } from './testkit';

function seedMany(db: Db) {
  const stages = ['erfasst', 'kontrolliert', 'erfasst', 'erfasst', 'kontrolliert'];
  const befunde = ['Äste trocken', 'ast', 'Pilzbefall', null, 'pilz am Stamm'];
  for (let i = 0; i < 5; i++)
    insert(db, {
      id: `t${i}`,
      stage: stages[i] as string,
      befund: befunde[i] as string | null,
      hoehe_m: [12.5, 3, 40, 7, 3][i] as number,
      kontrolle_faellig: i % 2 === 0,
      by: i < 3 ? 'anna' : 'bernd',
      at: `2026-02-0${i + 1}T00:00:00.000Z`,
    });
  insert(db, { id: 'g1', stage: 'erfasst', lifecycle: 'deleted', befund: 'weg' });
  insert(db, { id: 'a1', stage: 'erfasst', lifecycle: 'archived', befund: 'alt' });
  insert(db, { id: 'c1', stage: 'kontrolliert', lifecycle: 'completed', befund: 'fertig' });
  insert(db, { id: 'o1', type: 'flaeche', befund: 'other type' });
}

describe('admin feature list: paging', () => {
  it('pages without repeats or skips while rows are written between pages', async () => {
    const w = world();
    for (let i = 0; i < 20; i++) insert(w.db, { id: `p${String(i).padStart(2, '0')}`, befund: `b${i % 6}` });
    const seen: string[] = [];
    let next: string | null = null;
    let round = 0;
    do {
      const page: FeaturePage = await w.list(`sort=befund&limit=3${next === null ? '' : `&cursor=${next}`}`);
      seen.push(...ids(page));
      next = page.next;
      // concurrent writes: rows that sort before and after the cursor, and a change to an unrelated property
      insert(w.db, { id: `n${round}`, befund: `b${round % 6}` });
      w.db
        .prepare("UPDATE features SET properties = json_set(properties, '$.stage', 'x') WHERE id = 'p19'")
        .run();
      round++;
    } while (next !== null);
    const original = Array.from({ length: 20 }, (_, i) => `p${String(i).padStart(2, '0')}`);
    expect(new Set(seen).size).toBe(seen.length);
    // every original row not changed after being read is seen exactly once
    for (const id of original) expect(seen.filter((x) => x === id)).toHaveLength(1);
  });

  it('keeps pages stable when many rows share a sort value or have none', async () => {
    const w = world();
    for (let i = 0; i < 10; i++) insert(w.db, { id: `s${i}`, befund: i < 4 ? null : 'same' });
    for (const dir of ['asc', 'desc']) {
      const seen: string[] = [];
      let next: string | null = null;
      do {
        const page: FeaturePage = await w.list(
          `sort=befund&dir=${dir}&limit=3${next === null ? '' : `&cursor=${next}`}`,
        );
        seen.push(...ids(page));
        next = page.next;
      } while (next !== null);
      expect(seen.sort()).toEqual(Array.from({ length: 10 }, (_, i) => `s${i}`));
    }
  });

  it('rejects a cursor of another sort, and unknown parameters and columns', async () => {
    const w = world();
    for (let i = 0; i < 4; i++) insert(w.db, { id: `x${i}`, befund: `b${i}` });
    const page = await w.list('sort=befund&limit=2');
    for (const q of [
      `sort=stage&cursor=${page.next}`,
      'nonsense=1',
      'sort=nope',
      'filter.nope=1',
      'dir=up',
      'limit=0',
      'lifecycle=gone',
      'sort=beschreibung',
    ]) {
      const r = w.handlers.list(w.call(`features?type=baum&${q}`));
      expect(r.status, q).toBe(400);
    }
    expect(w.handlers.list(w.call('features?type=nope')).status).toBe(404);
    expect(w.handlers.list(w.call('features?type=baum', null)).status).toBe(401);
  });
});

describe('admin feature list: sort', () => {
  it('sorts by text (case-insensitive), number, stage and createdAt, asc and desc', async () => {
    const w = world();
    seedMany(w.db);
    const order = async (q: string) => ids(await w.list(q));
    // rows without a value first, then case-insensitive binary order (non-ASCII letters last)
    expect(await order('sort=befund')).toEqual(['t3', 'a1', 't1', 'c1', 't4', 't2', 't0']);
    expect(await order('sort=befund&dir=desc')).toEqual(['t0', 't2', 't4', 'c1', 't1', 'a1', 't3']);
    const nums = (await w.list('sort=hoehe_m')).rows.map((r) => r['hoehe_m']);
    expect(nums.filter((n) => n !== undefined)).toEqual([3, 3, 7, 12.5, 40]);
    const numsDesc = (await w.list('sort=hoehe_m&dir=desc')).rows.map((r) => r['hoehe_m']);
    expect(numsDesc.filter((n) => n !== undefined)).toEqual([40, 12.5, 7, 3, 3]);
    const stages = (await w.list('sort=stage')).rows.map((r) => r['stage']);
    expect(stages).toEqual([...stages].sort());
    const stagesDesc = (await w.list('sort=stage&dir=desc')).rows.map((r) => r['stage']);
    expect(stagesDesc).toEqual([...stagesDesc].sort().reverse());
    const created = (await w.list('sort=$created_at')).rows.map((r) => r.$created_at);
    expect(created).toEqual([...created].sort());
    const createdDesc = (await w.list('sort=$created_at&dir=desc')).rows.map((r) => r.$created_at);
    expect(createdDesc).toEqual([...createdDesc].sort().reverse());
  });

  it('sorts text without regard to case', async () => {
    const w = world();
    insert(w.db, { id: 'u1', befund: 'banane' });
    insert(w.db, { id: 'u2', befund: 'Apfel' });
    insert(w.db, { id: 'u3', befund: 'cherry' });
    expect(ids(await w.list('sort=befund'))).toEqual(['u2', 'u1', 'u3']);
  });
});

describe('admin feature list: filter, search, total', () => {
  it('filters per column with several values, and combines with search; total matches', async () => {
    const w = world();
    seedMany(w.db);
    const stage = await w.list('filter.stage=kontrolliert&sort=$id');
    expect(ids(stage)).toEqual(['c1', 't1', 't4']);
    expect(stage.total).toBe(3);
    const two = await w.list('filter.hoehe_m=3,40');
    expect(ids(two).sort()).toEqual(['t1', 't2', 't4']);
    const both = await w.list('filter.stage=erfasst&filter.$created_by=bernd,anna');
    expect(both.total).toBe(4);
    const searched = await w.list('q=pilz');
    expect(ids(searched).sort()).toEqual(['t2', 't4']);
    const combined = await w.list('q=pilz&filter.stage=kontrolliert');
    expect(ids(combined)).toEqual(['t4']);
    expect(combined.total).toBe(1);
    const paged = await w.list('filter.stage=erfasst,kontrolliert&limit=2');
    expect(paged.rows).toHaveLength(2);
    expect(paged.total).toBe(7);
    expect(paged.next).not.toBeNull();
  });

  it('searches case-insensitively and treats % and _ literally', async () => {
    const w = world();
    insert(w.db, { id: 'q1', befund: '50% Pilz' });
    insert(w.db, { id: 'q2', befund: 'plain' });
    expect(ids(await w.list('q=PILZ'))).toEqual(['q1']);
    expect(ids(await w.list('q=%25'))).toEqual(['q1']);
    expect(ids(await w.list('q=_'))).toEqual([]);
  });

  it("search '#4139' finds the feature whose id ends in 4139, not one that only contains 4139 elsewhere in its id", async () => {
    const w = world();
    insert(w.db, { id: 'aaaa-bbbb-4139', befund: 'x' });
    insert(w.db, { id: '4139-bbbb-cccc', befund: 'y' });
    expect(ids(await w.list('q=%234139'))).toEqual(['aaaa-bbbb-4139']);
    expect(ids(await w.list('q=4139'))).toEqual(['aaaa-bbbb-4139']);
    expect(ids(await w.list('q=39'))).toEqual(['aaaa-bbbb-4139']);
  });

  it('finds values with quotes, backslashes and umlauts, and the creator', async () => {
    const w = world();
    insert(w.db, { id: 'e1', befund: 'Ast "trocken"' });
    insert(w.db, { id: 'e2', befund: 'Pfad C:\\x' });
    insert(w.db, { id: 'e3', befund: 'Äste', by: 'Zoe' });
    expect(ids(await w.list('q=%22trocken%22'))).toEqual(['e1']);
    expect(ids(await w.list('q=C:%5Cx'))).toEqual(['e2']);
    expect(ids(await w.list('q=%C3%84ste'))).toEqual(['e3']);
    expect(ids(await w.list('q=zoe'))).toEqual(['e3']);
  });

  it('filters booleans and the empty value', async () => {
    const w = world();
    seedMany(w.db);
    expect((await w.list('filter.kontrolle_faellig=true')).total).toBe(3);
    expect((await w.list('filter.kontrolle_faellig=false')).total).toBe(2);
    expect(ids(await w.list('filter.befund=__empty__'))).toEqual(['t3']);
  });
});

describe('admin feature list: distinct values', () => {
  it('counts values and respects the other active filters but not its own', async () => {
    const w = world();
    seedMany(w.db);
    const all = await w.distinct('column=stage');
    expect(all).toEqual([
      { value: 'erfasst', count: 4 },
      { value: 'kontrolliert', count: 3 },
    ]);
    const byCreator = await w.distinct('column=stage&filter.$created_by=bernd');
    expect(byCreator).toEqual([
      { value: 'erfasst', count: 1 },
      { value: 'kontrolliert', count: 1 },
    ]);
    const own = await w.distinct('column=stage&filter.stage=erfasst');
    expect(own).toHaveLength(2);
    const searched = await w.distinct('column=stage&q=pilz');
    expect(searched.reduce((n, v) => n + v.count, 0)).toBe(2);
    const nums = await w.distinct('column=hoehe_m');
    expect(nums.find((v) => v.value === 3)?.count).toBe(2);
    expect(nums.find((v) => v.value === null)?.count).toBe(2);
    const bools = await w.distinct('column=kontrolle_faellig');
    expect(bools.find((v) => v.value === true)?.count).toBe(3);
  });

  it('counts lifecycle states and caps at 500 values', async () => {
    const w = world();
    seedMany(w.db);
    expect(await w.distinct('column=$lifecycle&lifecycle=active,completed,archived,deleted')).toEqual(
      expect.arrayContaining([
        { value: 'active', count: 5 },
        { value: 'deleted', count: 1 },
      ]),
    );
    for (let i = 0; i < 600; i++) insert(w.db, { id: `m${i}`, befund: `v${String(i).padStart(3, '0')}` });
    expect(await w.distinct('column=befund')).toHaveLength(500);
  });

  it('rejects a missing or opaque column', async () => {
    const w = world();
    expect(w.handlers.distinct(w.call('features/distinct?type=baum')).status).toBe(400);
    expect(w.handlers.distinct(w.call('features/distinct?type=baum&column=foto')).status).toBe(400);
    expect(w.handlers.distinct(w.call('features/distinct?type=baum&column=stage&sort=$id')).status).toBe(400);
  });
});

describe('admin feature list: lifecycle and audit columns', () => {
  it('hides deleted by default and shows any named states', async () => {
    const w = world();
    seedMany(w.db);
    const dflt = await w.list('sort=$id');
    expect(ids(dflt)).toEqual(['a1', 'c1', 't0', 't1', 't2', 't3', 't4']);
    expect(dflt.total).toBe(7);
    expect(ids(await w.list('lifecycle=deleted'))).toEqual(['g1']);
    expect((await w.list('lifecycle=active,deleted')).total).toBe(6);
    expect((await w.list('lifecycle=archived')).rows[0]?.$lifecycle).toBe('archived');
  });

  it('returns the audit columns and the anchor on every row', async () => {
    const w = world();
    seedMany(w.db);
    const row = (await w.list('filter.$id=t1')).rows[0];
    expect(row).toMatchObject({
      $id: 't1',
      $lifecycle: 'active',
      $created_by: 'anna',
      $created_at: '2026-02-02T00:00:00.000Z',
      $changed_at: '2026-02-02T00:00:00.000Z',
      lon: 7.1,
      lat: 50.7,
      stage: 'kontrolliert',
    });
  });
});

describe('admin feature list: system columns and properties never meet', () => {
  /** A baum type whose properties are called like system fields: `$` cannot start a property key (KeySchema). */
  const shadowed = (c: CompiledConfig): CompiledConfig => {
    const baum = c.file.types?.['baum'] as NonNullable<NonNullable<CompiledConfig['file']['types']>['baum']>;
    const text = { type: 'text', label: { de: 'x' } } as const;
    const properties = { ...baum.properties, lifecycle: text, id: text };
    return { ...c, file: { ...c.file, types: { ...c.file.types, baum: { ...baum, properties } } } };
  };

  it('rejects a property key that starts with the sigil', () => {
    expect(KeySchema.safeParse('$id').success).toBe(false);
    expect(KeySchema.safeParse('$lifecycle').success).toBe(false);
  });

  it('sorts, filters and shows a property called lifecycle and one called id on their own', async () => {
    const w = world(shadowed);
    insert(w.db, { id: 'r1', props: { lifecycle: 'beta', id: 'z' } });
    insert(w.db, { id: 'r2', props: { lifecycle: 'Alpha', id: 'y' } });
    insert(w.db, { id: 'r3', lifecycle: 'archived', props: { lifecycle: 'gamma', id: 'x' } });
    expect(ids(await w.list('sort=lifecycle'))).toEqual(['r2', 'r1', 'r3']);
    expect(ids(await w.list('sort=id'))).toEqual(['r3', 'r2', 'r1']);
    expect(ids(await w.list('sort=$id&dir=desc'))).toEqual(['r3', 'r2', 'r1']);
    expect(ids(await w.list('filter.lifecycle=beta'))).toEqual(['r1']);
    expect(ids(await w.list('filter.id=y'))).toEqual(['r2']);
    expect(ids(await w.list('filter.$lifecycle=archived&lifecycle=archived'))).toEqual(['r3']);
    const row = (await w.list('filter.id=z')).rows[0];
    expect(row).toMatchObject({ $id: 'r1', $lifecycle: 'active', lifecycle: 'beta', id: 'z' });
    const values = await w.distinct('column=lifecycle&lifecycle=active,archived');
    expect(values.map((v) => v.value).sort()).toEqual(['Alpha', 'beta', 'gamma']);
  });

  it('refuses the camelCase names of the old contract', async () => {
    const w = world();
    for (const q of ['sort=createdAt', 'filter.createdBy=anna', 'sort=id'])
      expect(w.handlers.list(w.call(`features?type=baum&${q}`)).status).toBe(400);
  });
});

describe('admin feature list: text order does not depend on an index', () => {
  it('gives the same order for an unindexed and an indexed text property', async () => {
    const w = world();
    const values = ['b', 'A', 'a', 'Ä', 'B', 'ab', 'Z', 'z', 'a_', 'a-'];
    values.forEach((v, i) => insert(w.db, { id: `x${i}`, befund: v, props: { zustaendig: v } }));
    for (const dir of ['asc', 'desc']) {
      const plain = ids(await w.list(`sort=befund&dir=${dir}&limit=100`));
      const indexed = ids(await w.list(`sort=zustaendig&dir=${dir}&limit=100`));
      expect(indexed).toEqual(plain);
    }
  });
});

describe('admin feature list: binary system columns', () => {
  it('sorts $id and the timestamps binary, $created_by case-insensitively', async () => {
    const w = world();
    insert(w.db, { id: 'B1', by: 'anna', at: '2026-01-02T00:00:00.000Z' });
    insert(w.db, { id: 'a1', by: 'Bernd', at: '2026-01-01T00:00:00.000Z' });
    expect(ids(await w.list('sort=$id'))).toEqual(['B1', 'a1']);
    expect(ids(await w.list('sort=$created_at'))).toEqual(['a1', 'B1']);
    expect(ids(await w.list('sort=$created_by'))).toEqual(['B1', 'a1']);
  });
});
