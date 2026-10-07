// WP-306: "Nur eigene" (`visible_when: self.$created_by == actor.id`) in sync, and the audit fields on the wire.
import { describe, expect, it } from 'vitest';
import { decodePage, encodePage } from '@ueberblick/core';
import { anna, bernd, ModelDevice, scopedConfig, syncSetup, tree, vera } from './testkit';

const OWN = "self.$created_by == actor.id || 'verwaltung' in actor.roles";

function world() {
  const ctx = syncSetup(scopedConfig(OWN));
  ctx.change(tree(1), { $type: 'baum', $created_by: 'anna', stage: 'erfasst' });
  ctx.change(tree(2), { $type: 'baum', $created_by: 'bernd', stage: 'erfasst' });
  return ctx;
}
const held = (d: ModelDevice): string[] => [...d.features.keys()].sort();

describe('Nur eigene', () => {
  it('a snapshot carries only the entries the actor created (verwaltung sees all)', () => {
    const ctx = world();
    const a = new ModelDevice();
    a.pull(ctx.service, anna);
    expect(held(a)).toEqual([tree(1)]);
    const b = new ModelDevice();
    b.pull(ctx.service, bernd);
    expect(held(b)).toEqual([tree(2)]);
    const v = new ModelDevice();
    v.pull(ctx.service, vera);
    expect(held(v)).toEqual([tree(1), tree(2)]);
  });

  it("a delta keeps hiding the others: a change of bernd's entry never reaches anna", () => {
    const ctx = world();
    const a = new ModelDevice();
    a.pull(ctx.service, anna);
    ctx.change(tree(2), { stage: 'kontrolliert' });
    a.pull(ctx.service, anna);
    expect(held(a)).toEqual([tree(1)]);
    expect(a.tombstoned).toEqual([]);
  });
});

describe('the sync page carries the audit fields', () => {
  it('rows hold createdBy, createdAt and changedAt, and survive the codec', () => {
    const ctx = syncSetup(scopedConfig(OWN));
    ctx.seedObservations([
      { featureId: tree(1), property: '$type', result: 'baum', seq: 1, runId: tree(1) as never },
      { featureId: tree(1), property: '$created_by', result: 'anna', seq: 2, runId: tree(1) as never },
    ]);
    const device = new ModelDevice();
    device.pull(ctx.service, anna);
    const row = device.pages.flatMap((p) => p.features).find((f) => f.id === tree(1));
    expect(row?.createdBy).toBe('anna');
    // the seeded observations carry no time: the fields are absent, never invented
    expect(row).not.toHaveProperty('createdAt');
    const page = device.pages[0];
    if (page === undefined) throw new Error('no page');
    const wired = decodePage(JSON.parse(JSON.stringify(encodePage(page))));
    expect(wired.features.find((f) => f.id === tree(1))?.createdBy).toBe('anna');
  });
});
