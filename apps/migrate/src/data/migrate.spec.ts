/** WP-301 acceptance: the golden conversion, history, geometry, text, resume, permissions. */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { listAutos, type Actor, type Key } from '@ueberblick/core';
import {
  checkpoint,
  convertData,
  createIdMap,
  DataExportError,
  migrate,
  readDataExport,
  runMigration,
  type Checkpoint,
  type V3DataExport,
} from './index';
import { history, loadData, snapshot, world, type World } from './testing';

const expected = parse(
  readFileSync(
    new URL('../../../../fixtures/v3-synthetic/data/baumkontrolle.expected.yaml', import.meta.url),
    'utf8',
  ),
) as { problems: { code: string; record: string }[]; features: Record<string, unknown> };

const v3 = (): V3DataExport => readDataExport(loadData('baumkontrolle'));

const options = (w: World, extra: object = {}) => ({
  target: w.target,
  geo: w.geo,
  configVersion: w.configVersion,
  ...extra,
});

async function full(batchSize = 3) {
  const w = world();
  const r = await runMigration(w.store, v3(), w.converted.mapping, options(w, { batchSize }));
  return { w, r };
}

describe('golden conversion', () => {
  it('folds to the expected v4 state', async () => {
    const { w, r } = await full();
    const snap = snapshot(w.db, r.ids);
    expect(Object.keys(snap).sort()).toEqual(Object.keys(expected.features).sort());
    expect(snap).toEqual(expected.features);
  });

  it('reports what it left out, and nothing else', async () => {
    const { r } = await full();
    expect(r.problems.map((p) => ({ code: p.code, record: p.record }))).toEqual(expected.problems);
  });

  it('writes only import runs, atomically, through the store', async () => {
    const { w, r } = await full();
    const kinds = w.db
      .prepare<{ actor_kind: string; n: number }>(
        'SELECT actor_kind, count(*) AS n FROM runs GROUP BY actor_kind',
      )
      .all();
    expect(kinds).toEqual([{ actor_kind: 'import', n: r.accepted }]);
    const rejected = w.db
      .prepare<{ n: number }>("SELECT count(*) AS n FROM runs WHERE outcome = 'rejected'")
      .get();
    expect(rejected?.n).toBe(0);
  });

  it('gives the same run ids on every conversion of the same export', async () => {
    const a = await full();
    const b = await full(7);
    const ids = (w: World) => w.db.prepare<{ id: string }>('SELECT id FROM runs ORDER BY id').all();
    expect(ids(a.w)).toEqual(ids(b.w));
  });
});

describe('history', () => {
  it('keeps the order of the v3 log and the phenomenon times', async () => {
    const { w, r } = await full();
    const b1 = r.ids.get('b1') as string;
    const vitality = history(w.db, b1).filter((h) => h.property === 'vitalitaet');
    // recorded 03-01, 03-05 (observed on 03-03, offline) and 04-01
    expect(vitality.map((h) => [h.result, h.time])).toEqual([
      ['v2', '2025-03-01T10:00:00.000Z'],
      ['v3', '2025-03-03T14:00:00.000Z'],
      ['v1', '2025-04-01T09:00:00.000Z'],
    ]);
    const stage = history(w.db, b1).filter((h) => h.property === 'stage');
    expect(stage.map((h) => [h.result, h.time])).toEqual([
      ['erfasst', '2025-03-01T10:00:00.000Z'],
      ['kontrolliert', '2025-03-03T14:00:00.000Z'],
    ]);
  });

  it('moves the position in the history and keeps the height (H1)', async () => {
    const { w, r } = await full();
    const geom = history(w.db, r.ids.get('b1') as string).filter((h) => h.property === 'geom');
    expect(geom.map((h) => h.result)).toEqual([
      { type: 'Point', coordinates: [7.63, 51.961, 61.5] },
      { type: 'Point', coordinates: [7.6305, 51.9612, 62] },
    ]);
  });

  it('clears a relation when the list shrinks', async () => {
    const { w, r } = await full();
    const snap = snapshot(w.db, r.ids);
    expect(snap['m1']?.properties['baum']).toBe('@b1');
    expect(snap['m2']?.properties['baum']).toBeNull();
  });

  it('writes the references after every feature exists, at the time v3 wrote them', async () => {
    const { w, r } = await full();
    const refs = history(w.db, r.ids.get('b1') as string).filter(
      (h) => h.property === 'art' || h.property === 'flaeche_ref',
    );
    expect(refs.map((h) => h.time)).toEqual(['2025-03-01T10:00:00.000Z', '2025-03-01T10:00:00.000Z']);
  });
});

describe('geometry', () => {
  it('derives the anchor with core.geo, not from the v3 vertex mean', async () => {
    const { w, r } = await full();
    const fl1 = snapshot(w.db, r.ids)['fl1'];
    const source = (v3().instances.find((i) => i.id === 'fl1')?.geometry ?? null) as never;
    const surface = w.geo.derive(w.geo.normalise(source)).pointOnSurface.coordinates;
    expect(fl1?.anchor).toEqual([
      Math.round((surface[0] as number) * 1e7) / 1e7,
      Math.round((surface[1] as number) * 1e7) / 1e7,
    ]);
    // the v3 centroid: mean of the vertices of the outer ring, closing point dropped
    expect(fl1?.anchor[0]).not.toBeCloseTo(7.64, 3);
    expect(fl1?.anchor[1]).not.toBeCloseTo(51.97, 3);
  });

  it('leaves out an instance without a position and says so', async () => {
    const { r } = await full();
    expect(r.ids.get('b3')).toBeUndefined();
    expect(r.problems.find((p) => p.record === 'b3')?.code).toBe('no_geometry');
  });
});

describe('text', () => {
  it('stores text NFC-normalised', async () => {
    const { w, r } = await full();
    const befund = snapshot(w.db, r.ids)['b1']?.properties['befund'] as string;
    expect(befund).toBe('Pilzbefall am Stämmling');
    expect(befund).toBe(befund.normalize('NFC'));
  });
});

describe('resume', () => {
  it('continues after any interruption and ends in the same state', async () => {
    const reference = await full(2);
    const total = reference.r.batches;
    expect(total).toBeGreaterThan(4);
    for (let stopAt = 1; stopAt < total; stopAt++) {
      const w = world();
      const ids = createIdMap();
      let submitted = 0;
      const first = await migrate(
        w.store,
        convertData(v3(), w.converted.mapping, options(w, { batchSize: 2, ids })),
        ids,
        {
          after: () => (++submitted >= stopAt ? false : undefined),
        },
      );
      expect(first.stopped).toBe(true);
      // what a caller stores between the two calls, and reads back
      const saved = JSON.parse(JSON.stringify(checkpoint(first.next, ids))) as Checkpoint;
      const second = await runMigration(
        w.store,
        v3(),
        w.converted.mapping,
        options(w, { batchSize: 2, resume: saved }),
      );
      expect(second.stopped).toBe(false);
      expect(second.accepted + first.accepted).toBe(reference.r.accepted);
      const now = snapshot(w.db, second.ids);
      const then = snapshot(reference.w.db, reference.r.ids);
      expect(now).toEqual(then);
    }
  });

  it('is safe when the last batch was submitted but its checkpoint was lost', async () => {
    const reference = await full(2);
    const w = world();
    const ids = createIdMap();
    let submitted = 0;
    const first = await migrate(
      w.store,
      convertData(v3(), w.converted.mapping, options(w, { batchSize: 2, ids })),
      ids,
      {
        after: () => (++submitted >= 3 ? false : undefined),
      },
    );
    // resume one batch too early: the batch is submitted again and the ledger answers it from the first time
    const stale: Checkpoint = { next: first.next - 1, ids: checkpoint(first.next, ids).ids };
    const second = await runMigration(
      w.store,
      v3(),
      w.converted.mapping,
      options(w, { batchSize: 2, resume: stale }),
    );
    expect(snapshot(w.db, second.ids)).toEqual(snapshot(reference.w.db, reference.r.ids));
    const runs = w.db.prepare<{ n: number }>('SELECT count(*) AS n FROM runs').get();
    const runsReference = reference.w.db.prepare<{ n: number }>('SELECT count(*) AS n FROM runs').get();
    expect(runs?.n).toBe(runsReference?.n);
  });
});

describe('permissions', () => {
  it('offers the import tasks to the actor kind import only', () => {
    const w = world();
    const tasks = w.target.file.tasks ?? {};
    for (const t of Object.values(w.target.tasks)) {
      expect(tasks[t.create]?.who).toEqual(['import']);
      expect(tasks[t.update]?.who).toEqual(['import']);
    }
    const participant: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
    const r = w.store.submit({
      id: 'aaaaaaaa-0000-7000-8000-000000000001' as never,
      task: w.target.tasks['baum']?.create as Key,
      actor: participant,
      configVersion: w.configVersion,
      input: { geom: { type: 'Point', coordinates: [7, 51] } },
    });
    expect(r.outcome).toBe('refused');
  });

  it('refuses a participant on the update task of an existing feature and accepts the import actor on both', async () => {
    const { w, r } = await full();
    const key = Object.entries(snapshot(w.db, r.ids)).find(([, f]) => f.type === 'baum')?.[0];
    const id = key === undefined ? undefined : r.ids.get(key);
    expect(id).toBeDefined();
    const t = w.target.tasks['baum'];
    const feature = { type: 'Point', coordinates: [7, 51] };
    const run = (n: number, task: string | undefined, actor: Actor, extra: object) =>
      w.store.submit({
        id: `aaaaaaaa-0000-7000-8000-00000000010${n}` as never,
        task: task as Key,
        actor,
        configVersion: w.configVersion,
        input: { hoehe_m: 12 },
        ...extra,
      });
    const participant: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
    const importer: Actor = { id: 'import', kind: 'import', roles: [] };
    expect(run(1, t?.update, participant, { featureId: id }).outcome).toBe('refused');
    expect(run(2, t?.create, participant, { input: { geom: feature } }).outcome).toBe('refused');
    expect(run(3, t?.update, importer, { featureId: id }).outcome).toBe('accepted');
    expect(run(4, t?.create, importer, { input: { geom: feature } }).outcome).toBe('accepted');
  });

  it('leaves the automatic actions out, so history does not fire them again', () => {
    expect(listAutos(world().target.file)).toEqual([]);
  });
});

describe('reading the export', () => {
  it('names the place of a malformed record', () => {
    const bad = {
      format: 1,
      instances: [{ id: 'x', workflow: 'baum', log: [{ field: 'a', recordedAt: 't' }] }],
    };
    expect(() => readDataExport(bad)).toThrowError(DataExportError);
    expect(() => readDataExport(bad)).toThrowError(/instances\.0\.log\.0\./);
  });

  it('refuses another format and a repeated id', () => {
    expect(() => readDataExport({ format: 2 })).toThrowError(/format/);
    const twice = {
      format: 1,
      instances: [
        { id: 'x', workflow: 'w' },
        { id: 'x', workflow: 'w' },
      ],
    };
    expect(() => readDataExport(twice)).toThrowError(/twice/);
  });
});
