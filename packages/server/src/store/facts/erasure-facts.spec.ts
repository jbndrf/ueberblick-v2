// WP-534.1: the erasure reads of Facts over SQLite (`observationsByActor` through runs(actor), `featuresWith`).
import { describe, expect, it } from 'vitest';
import type { RunId } from '@ueberblick/core';
import { createFacts } from './index';
import { INVERSE, Model, fid, ingest, k, ob, openDb } from './sqlite.testkit';

describe('Facts.observationsByActor', () => {
  it('returns the observations of the actor`s runs ascending by seq and nothing for a stranger', () => {
    const db = openDb();
    db.prepare(
      `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
       VALUES ('r2', 'u2', 'participant', 't', 1, '{}', '2026-01-01T00:00:00.000Z', 'accepted')`,
    ).run();
    ingest(
      db,
      new Model(),
      [ob('t0', '$type', 'tree', 1), { ...ob('t0', 'name', 'Linde', 2), runId: 'r2' as RunId }],
      10,
    );
    const facts = createFacts(db, INVERSE);
    expect(facts.observationsByActor('u1').map((o) => [o.seq, o.property, o.result])).toEqual([
      [1, '$type', 'tree'],
    ]);
    expect(facts.observationsByActor('u2').map((o) => [o.seq, o.property, o.result, o.runId])).toEqual([
      [2, 'name', 'Linde', 'r2'],
    ]);
    expect(facts.observationsByActor('nobody')).toEqual([]);
  });
});

describe('Facts.featuresWith', () => {
  it('finds live features of a type whose property equals the value, in id order', () => {
    const db = openDb();
    ingest(
      db,
      new Model(),
      [
        ob('t1', '$type', 'tree', 1),
        ob('t1', 'name', 'karl', 2),
        ob('t0', '$type', 'tree', 3),
        ob('t0', 'name', 'karl', 4),
        ob('t2', '$type', 'tree', 5),
        ob('t2', 'name', 'lisa', 6),
        ob('p0', '$type', 'plot', 7),
        ob('p0', 'name', 'karl', 8),
      ],
      10,
    );
    const facts = createFacts(db, INVERSE);
    expect([...facts.featuresWith(k('tree'), 'name', 'karl')].map((f) => f.id)).toEqual([
      fid('t0'),
      fid('t1'),
    ]);
    expect([...facts.featuresWith(k('tree'), 'name', 'nobody')]).toEqual([]);
  });
});
