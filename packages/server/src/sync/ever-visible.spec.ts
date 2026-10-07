/**
 * Relation-dependent `visible_when` (WP-137, review note of WP-106). `ever-visible` replays the history of a
 * feature: its own properties and outgoing references come from that history, but the features they lead to (and
 * inverse relations) are read as they are NOW. Consequence, pinned here so it cannot change
 * unnoticed: a feature that was never visible can produce an id-only tombstone (docs/decisions/later/A-015).
 */
import { describe, expect, it } from 'vitest';
import { fid } from '../store/run/testkit';
import { anna, ModelDevice, RELATION_VISIBLE_WHEN, scopedConfig, syncSetup, tree } from './testkit';

const LINDE = fid(1);
const EICHE = fid(2);

describe('ever-visible with a relation-dependent visible_when', () => {
  const setup = () => {
    const ctx = syncSetup(scopedConfig(RELATION_VISIBLE_WHEN));
    ctx.seed([
      { id: LINDE, type: 'baumart', properties: { name_de: 'Linde' } },
      { id: EICHE, type: 'baumart', properties: { name_de: 'Eiche' } },
    ]);
    return ctx;
  };

  const trees = (d: ModelDevice): number => [...d.features.values()].filter((f) => f.type === 'baum').length;

  it('a tree that stays invisible produces no tombstone while relations stay put', () => {
    const ctx = setup();
    const device = new ModelDevice();
    ctx.change(tree(1), { $type: 'baum', stage: 'erfasst', art: EICHE });
    device.pull(ctx.service, anna);
    ctx.change(tree(1), { beschreibung: 'x' });
    device.pull(ctx.service, anna);
    expect(trees(device)).toBe(0);
    expect(device.tombstoned).toEqual([]);
  });

  it('a tree that becomes visible arrives as a row', () => {
    const ctx = setup();
    const device = new ModelDevice();
    ctx.change(tree(1), { $type: 'baum', stage: 'erfasst', art: LINDE });
    device.pull(ctx.service, anna);
    ctx.change(tree(1), { stage: 'kontrolliert' });
    device.pull(ctx.service, anna);
    expect(trees(device)).toBe(1);
  });

  it('a tree whose relation was cleared, then deleted, is still tombstoned (the replay reads its own history)', () => {
    const ctx = setup();
    const device = new ModelDevice();
    ctx.change(tree(1), { $type: 'baum', stage: 'kontrolliert', art: LINDE });
    device.pull(ctx.service, anna);
    expect(trees(device)).toBe(1);
    ctx.change(tree(1), { art: null });
    ctx.change(tree(1), { $lifecycle: 'deleted' });
    device.pull(ctx.service, anna);
    expect(trees(device)).toBe(0);
  });

  it('KNOWN LIMIT (A-015): a related feature is read as it is now, so a never-visible tree can tombstone once', () => {
    const ctx = setup();
    ctx.change(LINDE, { name_de: 'Buche' }); // the species is not called Linde yet
    const device = new ModelDevice();
    // history: a checked tree of the species "Buche", which anna is never shown ...
    ctx.change(tree(1), { $type: 'baum', stage: 'kontrolliert', art: LINDE });
    device.pull(ctx.service, anna);
    // ... later the species is renamed and the tree set back to `erfasst` (invisible now)
    ctx.change(LINDE, { name_de: 'Linde' });
    ctx.change(tree(1), { stage: 'erfasst' });
    device.pull(ctx.service, anna);
    expect(trees(device)).toBe(0);
    // replaying the first state against the CURRENT name says "visible once": an id-only tombstone
    expect(device.tombstoned).toEqual([{ id: tree(1), held: false }]);
  });
});
