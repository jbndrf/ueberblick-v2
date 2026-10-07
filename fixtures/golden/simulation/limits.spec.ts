/**
 * Accepted limits of the device (docs/07), encoded as expected behaviour and not as failures. They are why the
 * random simulation shows some server refusals of runs the device accepted, and why convergence is judged on
 * the confirmed state after a pull, never on a prediction:
 * - (WP-748: no longer a limit) the ids a run creates are `seededIds(run.id)` on device and server, so the device's
 *   prediction of a created or rule-created feature is the server's row and a follow-up run on it is accepted,
 * - a prediction covers reference edges only; derived edges (geometry relations) arrive with the pull.
 */
import { describe, expect, it } from 'vitest';
import type { Actor, FeatureId, Key } from '../../../packages/core/src/model';
import { baumWorkload, createIds, createRng, createClock, START } from '../../../packages/core/src/testing';
import { RealDevice } from '../../../packages/client/src/simulation/device.testing';
import { Faults, NO_FAULTS } from '../../../packages/client/src/simulation/net.testing';
import { sqliteBackend } from './backend';

const anna: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };

async function scripted(): Promise<{ device: RealDevice; backend: ReturnType<typeof sqliteBackend> }> {
  const workload = baumWorkload();
  const clock = createClock(START);
  const backend = sqliteBackend(workload, clock);
  backend.seed((store) => workload.seed(store));
  const faults = new Faults(createRng(1), NO_FAULTS, () => 0);
  const device = await RealDevice.open({ index: 0, actor: anna, backend, clock, faults, ids: createIds(1), maxRows: 50 });
  await device.pull();
  return { device, backend };
}

const treeWhere = (d: RealDevice, has: (p: Readonly<Record<string, unknown>>) => boolean): FeatureId => {
  const id = d.store.featureIdsOfType('baum').find((f) => has(d.store.facts.feature(f)?.properties ?? {}));
  if (id === undefined) throw new Error('seed tree not found');
  return id;
};
/** Features of `type` the device predicts but does not hold confirmed (`featureIdsOfType` lists confirmed ones only). */
const predicted = (d: RealDevice, type: string): FeatureId[] => {
  const confirmed = new Set(d.store.featureIdsOfType(type));
  const all: FeatureId[] = [];
  for (const f of d.store.facts.near(type as Key, [-180, -90, 180, 90])) all.push(f.id);
  return all.filter((id) => !confirmed.has(id));
};
const derived = (d: RealDevice): string[] => d.dump().edges.filter((e) => e.endsWith('|true'));

describe('accepted limits of the device (encoded as expected behaviour)', () => {
  it('a feature id a rule creates is the same on the server (WP-748)', async () => {
    const { device, backend } = await scripted();
    const tree = treeWhere(device, (p) => p['befund'] === 'unauffällig');
    const before = new Set(device.store.featureIdsOfType('massnahme'));
    const edgesBefore = new Set(device.store.facts.edgesTo(tree).map((e) => e.from));
    // vitalitaet v4 fires the rule massnahme_bei_schaden, which runs massnahme_anlegen
    const r = await device.create({ task: 'kontrolle' as Key, actor: anna, featureId: tree, input: { vitalitaet: 'v4', befund: 'Sturmschaden' } });
    expect(r.ok).toBe(true);
    const guessed = device.store.facts.edgesTo(tree).map((e) => e.from).filter((id) => !edgesBefore.has(id));
    expect(guessed).toHaveLength(1); // the prediction holds the rule's measure under its seeded id
    expect(device.store.facts.feature(guessed[0] as FeatureId)?.type).toBe('massnahme');

    await device.drain();
    await device.pull();
    const server = [...backend.audit().features].filter(([, f]) => f.type === 'massnahme').map(([id]) => id);
    const onDevice = device.store.featureIdsOfType('massnahme');
    expect(server).toHaveLength(before.size + 1);
    expect([...onDevice].sort()).toEqual([...server].sort());
    expect(onDevice).toContain(guessed[0]); // the predicted id is the server's id
    expect(predicted(device, 'massnahme')).toEqual([]);
  });

  it('a prediction covers reference edges only: a derived edge arrives with the pull', async () => {
    const { device } = await scripted();
    const tree = treeWhere(device, (p) => p['vitalitaet'] === 'v4');
    const before = derived(device);
    const inPark = { type: 'Point', coordinates: [7.102, 50.732] };
    const r = await device.create({ task: 'verschieben' as Key, actor: anna, featureId: tree, input: { geometrie: inPark } });
    expect(r.ok).toBe(true);
    expect(derived(device)).toEqual(before); // predicted: the new geometry, but no new derived edge yet

    await device.drain();
    await device.pull();
    expect(derived(device).length).toBeGreaterThan(before.length);
  });

  it('a run on a feature that exists only as a prediction is accepted: the server stores it under the same id (WP-748)', async () => {
    const { device, backend } = await scripted();
    const made = await device.create({
      task: 'erfassen' as Key,
      actor: anna,
      input: { geometrie: { type: 'Point', coordinates: [7.1, 50.72] }, vitalitaet: 'v1' },
    });
    expect(made.ok).toBe(true);
    const planned = predicted(device, 'baum')[0];
    expect(planned).toBeDefined();
    const follow = await device.create({ task: 'befund_ergaenzen' as Key, actor: anna, featureId: planned as FeatureId, input: { befund: 'Nachtrag' } });
    expect(follow.ok).toBe(true); // the device plans it against its prediction

    await device.drain();
    await device.pull();
    await device.drain();
    expect(device.queue.status().refused).toHaveLength(0);
    const id = device.submitted[1]?.id;
    expect(backend.audit().runs.get(id as never)?.outcome).toBe('accepted');
    expect(device.store.featureIdsOfType('baum')).toContain(planned);
    expect(device.livePending()).toBe(0);
  });
});
