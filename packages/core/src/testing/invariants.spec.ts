// WP-050: the invariants can fail (tampering is reported).
import { describe, expect, it } from 'vitest';
import type { FeatureId } from '../model';
import { DEFAULT_OPTIONS, baumWorkload, checkInvariants, simulateWorld, type SimOptions } from './index';

const workload = baumWorkload();
const opts = (seed: number, over: Partial<SimOptions> = {}): SimOptions => ({
  ...DEFAULT_OPTIONS,
  seed,
  ...over,
});

describe('the invariants can fail: tampering with a finished simulation is reported', () => {
  const world = () => simulateWorld(workload, opts(3, { ticks: 60, adminRate: 0.5 }));
  const kinds = (w: ReturnType<typeof world>): string[] => checkInvariants(w.input).map((v) => v.invariant);

  it('a clean simulation reports nothing', () => {
    expect(kinds(world())).toEqual([]);
  });

  it('convergence: a device that lost a feature', () => {
    const w = world();
    const d = w.input.devices[0];
    const id = [...(d?.store.features.keys() ?? [])][0];
    if (!d || !id) throw new Error('no device state');
    d.store.features.delete(id);
    expect(kinds(w)).toContain('convergence');
  });

  it('no accepted run lost: an accepted run whose observations vanished from the log', () => {
    const w = world();
    const [id] = [...w.input.server.accepted.keys()];
    expect(id).toBeDefined();
    const log = w.input.server.store.log;
    for (let i = log.length - 1; i >= 0; i--) if (log[i]?.runId === id) log.splice(i, 1);
    expect(kinds(w)).toContain('no_accepted_run_lost');
  });

  it('a refusal leaves no trace: an observation of a refused run in the log', () => {
    const w = world();
    const entry = [...w.input.server.ledger].find(([, e]) => !e.ok);
    if (!entry) throw new Error('seed has no server refusal');
    const featureId = [...w.input.server.store.features.keys()][0] as FeatureId;
    w.input.server.store.append(entry[0], [{ featureId, property: 'befund', result: 'x' }]);
    expect(kinds(w)).toContain('refusal_leaves_no_trace');
  });
});
