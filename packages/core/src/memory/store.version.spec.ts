// WP-569.1: MemoryStore takes the config version and hands it to the fold schema.
import { describe, expect, it } from 'vitest';
import { createGeo } from '../geo';
import { createClock } from '../testing/ids';
import { baumWorkload } from '../testing/workloads';
import { MemoryStore } from './store';

describe('MemoryStore config version', () => {
  const w = baumWorkload();
  const make = (v: number): MemoryStore =>
    new MemoryStore(w.config, createClock('2026-05-01T08:00:00Z'), createGeo(), v);

  it('builds its fold schema with the given version', () => {
    expect(make(7).schema.configVersion).toBe(7);
  });

  it('keeps the version in a clone', () => {
    expect(make(9).clone().schema.configVersion).toBe(9);
  });

  it('history with a limit of 0 returns nothing, like SQL LIMIT 0', () => {
    const s = make(1);
    w.seed(s);
    const o = s.log[0];
    if (o === undefined) throw new Error('seed must record observations');
    expect(s.history(o.featureId, o.property, 1)).toHaveLength(1);
    expect(s.history(o.featureId, o.property, 0)).toEqual([]);
  });
});
