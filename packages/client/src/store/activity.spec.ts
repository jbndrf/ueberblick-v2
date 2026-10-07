import { choosableHash } from '@ueberblick/core/sync';
import { describe, expect, it } from 'vitest';
import type { Run } from '@ueberblick/core/model';
import { openDeviceStore } from './open';
import { cursorAt, fakeEnv, feature, fid, key, memoryMarker, obs, rid, rows, syncRun } from './test-env';

const open = (env = fakeEnv(), marker = memoryMarker()) => openDeviceStore('p', { env, marker });
const people = [{ id: 'p1', name: 'Anna' }];

describe('run details on the device (WP-602)', () => {
  it('stores runs and people with the page and keeps them after a reload', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    await a.applyPage(
      rows({
        features: [feature(1, 2)],
        observations: [obs(1, 'height_m', 1), obs(1, 'note', 2)],
        runs: [syncRun(1), syncRun(2, null)],
        people,
      }),
      cursorAt(2),
    );
    expect(a.runMeta(rid(1))?.task).toBe('kontrolle');
    expect(a.personName('p1')).toBe('Anna');
    a.close();
    const b = await open(env, marker);
    await b.warmActivity(fid(1));
    expect(b.runMeta(rid(1))).toEqual(syncRun(1));
    expect(b.runMeta(rid(2))?.actor).toBeNull();
    expect(b.personName('p1')).toBe('Anna');
    expect(b.observationsOf(fid(1)).map((o) => o.seq)).toEqual([2, 1]);
  });

  it('trimming history drops run rows no history row references any more', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    const first = Array.from({ length: 12 }, (_, i) => obs(1, 'height_m', i + 1));
    await a.applyPage(
      rows({ features: [feature(1, 1)], observations: first, runs: first.map((_, i) => syncRun(i + 1)) }),
      cursorAt(12),
    );
    a.close();
    const b = await open(env, marker);
    await b.warmActivity(fid(1));
    expect(b.observationsOf(fid(1)).map((o) => o.seq)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(b.runMeta(rid(3))).toBeDefined();
    // runs 1 and 2 were trimmed with their observations: their rows are gone from the store
    expect(b.runMeta(rid(1))).toBeUndefined();
    expect(b.runMeta(rid(2))).toBeUndefined();
  });

  it('a run another property still references survives the trim', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    const many = Array.from({ length: 11 }, (_, i) => obs(1, 'height_m', i + 2, i));
    const first = { ...many[0], runId: rid(1) } as (typeof many)[number];
    await a.applyPage(
      rows({
        features: [feature(1, 1)],
        observations: [first, { ...obs(1, 'note', 1), runId: rid(1) }, ...many.slice(1)],
        runs: [syncRun(1), ...many.slice(1).map((o) => syncRun(o.seq))],
      }),
      cursorAt(12),
    );
    a.close();
    const b = await open(env, marker);
    await b.warmActivity(fid(1));
    expect(b.runMeta(rid(1))).toBeDefined(); // still referenced by `note`
  });

  it('a feature tombstone and dropHistory also release run rows; clearCache empties them', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    await a.applyPage(
      rows({
        features: [feature(1, 1), feature(2, 2)],
        observations: [obs(1, 'p', 1), obs(2, 'p', 2)],
        runs: [syncRun(1), syncRun(2)],
        people,
      }),
      cursorAt(2),
    );
    await a.dropHistory(fid(2), ['p']);
    await a.applyPage(rows({ tombstones: [{ seq: 3, kind: 'feature', id: fid(1) }] }), cursorAt(3, 'delta'));
    a.close();
    const b = await open(env, marker);
    await b.warmActivity(fid(1));
    await b.warmActivity(fid(2));
    expect(b.runMeta(rid(1))).toBeUndefined();
    expect(b.runMeta(rid(2))).toBeUndefined();
    await b.clearCache();
    expect(b.personName('p1')).toBeUndefined();
  });

  it('mirrors the queued runs of a feature for the reader and forgets removed ones', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const run: Run = {
      id: rid(9),
      task: key('kontrolle'),
      actor: { id: 'p1', kind: 'participant', roles: [key('feld')] },
      configVersion: 1,
      featureId: fid(1),
      input: { note: 'x' },
    };
    const a = await open(env, marker);
    await a.appendRuns([{ run }]);
    expect(a.queuedRunsOf(fid(1)).map((r) => r.run.id)).toEqual([rid(9)]);
    expect(a.queuedRunsOf(fid(2))).toEqual([]);
    await a.settleRuns([{ runId: rid(9), state: 'refused', refusal: { code: 'invalid_input' } as never }]);
    expect(a.queuedRunsOf(fid(1))[0]?.state).toBe('refused');
    a.close();
    const c = await open(env, marker);
    expect(c.queuedRunsOf(fid(1))).toHaveLength(1);
    await c.removeRuns([rid(9)]);
    expect(c.queuedRunsOf(fid(1))).toEqual([]);
  });
});

describe('choosable participants (WP-725)', () => {
  const set = (...p: [string, string][]) => p.map(([id, name]) => ({ id, name }));

  it('keeps the set, sorted by name, after a reload; clearing the cache drops it', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    expect(a.choosableParticipants()).toEqual([]);
    expect(a.choosableHash()).toBe('');
    await a.applyPage(
      rows({
        features: [feature(1, 1)],
        choosable: set(['p2', 'Zora'], ['p1', 'Anna'], ['p3', '']),
        people: [{ id: 'p4', name: 'Other' }],
      }),
      cursorAt(1),
    );
    const expected = [
      { id: 'p1', name: 'Anna' },
      { id: 'p2', name: 'Zora' },
      { id: 'p3', name: '' },
    ];
    expect(a.choosableParticipants()).toEqual(expected);
    expect(a.choosableHash()).toBe(choosableHash(expected));
    expect(a.personName('p3')).toBeUndefined(); // an empty name is no name
    expect(a.personName('p4')).toBeUndefined(); // not an actor of a stored run: not stored
    a.close();
    const b = await open(env, marker);
    expect(b.choosableParticipants()).toEqual(expected);
    expect(b.choosableHash()).toBe(choosableHash(expected));
    await b.clearCache();
    expect(b.choosableParticipants()).toEqual([]);
    expect(b.choosableHash()).toBe('');
  });

  it('a later list REPLACES the set (a removed participant goes, also after a reload); a page without one keeps it', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    await a.applyPage(rows({ choosable: set(['p1', 'Anna'], ['p2', 'Bernd']) }), cursorAt(1));
    await a.applyPage(rows({ features: [feature(1, 2)] }), cursorAt(2));
    expect(a.choosableParticipants().map((p) => p.id)).toEqual(['p1', 'p2']);
    await a.applyPage(rows({ choosable: set(['p1', 'Anna']) }), cursorAt(3));
    expect(a.choosableParticipants().map((p) => p.id)).toEqual(['p1']);
    a.close();
    const b = await open(env, marker);
    expect(b.choosableParticipants().map((p) => p.id)).toEqual(['p1']);
    await b.applyPage(rows({ choosable: set() }), cursorAt(4));
    expect(b.choosableParticipants()).toEqual([]);
    expect(b.choosableHash()).toBe('');
  });
});
