// WP-534.1: the Facts extension for erasure (`observationsByActor`, `featuresWith`) and the in-place purge, on MemoryStore.
import { describe, expect, it } from 'vitest';
import type { FeatureId, RunId } from '../model';
import { erasure } from '../plan/__fixtures__/erasure';
import { World, fid, rid } from '../plan/__fixtures__/world';

const seed = () => {
  const w = new World(erasure());
  const f1 = fid(1);
  const f2 = fid(2);
  w.append(
    rid(1),
    [
      { featureId: f1, property: '$type', result: 'position' },
      { featureId: f1, property: 'wo', result: 'Park' },
    ],
    'anna',
  );
  w.append(
    rid(2),
    [
      { featureId: f2, property: '$type', result: 'position' },
      { featureId: f2, property: 'wo', result: 'Markt' },
    ],
    'bernd',
  );
  w.append(rid(3), [{ featureId: f1, property: 'wo', result: 'Wald' }], 'anna');
  return { w, f1, f2 };
};

describe('Facts.observationsByActor', () => {
  it('returns every observation of the actor`s runs, ascending by seq, and nothing for a stranger', () => {
    const { w, f1 } = seed();
    const mine = w.observationsByActor('anna');
    expect(mine.map((o) => [o.featureId, o.property, o.result])).toEqual([
      [f1, '$type', 'position'],
      [f1, 'wo', 'Park'],
      [f1, 'wo', 'Wald'],
    ]);
    expect(mine.map((o) => o.seq)).toEqual([...mine.map((o) => o.seq)].sort((a, b) => a - b));
    expect(w.observationsByActor('nobody')).toEqual([]);
  });

  it('an append without an actor is attributed to no one', () => {
    const w = new World(erasure());
    w.add(fid(9), 'position', { wo: 'x' });
    expect(w.observationsByActor('anna')).toEqual([]);
  });

  it('a clone keeps the attribution', () => {
    const { w } = seed();
    expect(w.clone().observationsByActor('bernd')).toHaveLength(2);
  });
});

describe('Facts.featuresWith', () => {
  it('finds live features of a type whose property equals the value', () => {
    const w = new World(erasure());
    w.add(fid(1), 'meldung', { melder: 'karl', telefon: '1' });
    w.add(fid(2), 'meldung', { melder: 'lisa', telefon: '2' });
    w.add(fid(3), 'position', { wo: 'karl' });
    expect([...w.featuresWith('meldung' as never, 'melder', 'karl')].map((f) => f.id)).toEqual([fid(1)]);
    expect([...w.featuresWith('meldung' as never, 'melder', 'nobody')]).toEqual([]);
  });
});

describe('MemoryStore.purge', () => {
  it('blanks the stored results of a pair in the log and the history, keeps seq and run, leaves the folded state', () => {
    const { w, f1, f2 } = seed();
    const before = w.snapshot();
    w.purge([{ featureId: f1, property: 'wo' }]);
    expect(w.log.filter((o) => o.featureId === f1 && o.property === 'wo').map((o) => o.result)).toEqual([
      null,
      null,
    ]);
    expect(w.history(f1, 'wo', 10).every((o) => o.result === null)).toBe(true);
    expect(w.log.find((o) => o.featureId === f2 && o.property === 'wo')?.result).toBe('Markt');
    expect(w.snapshot()).toEqual(before);
    expect(w.log.map((o) => o.runId as RunId | FeatureId)).toContain(rid(1));
  });
});
