import { describe, expect, it } from 'vitest';
import { edgeKey, SYNC_PROTOCOL_VERSION, type Key, type SyncPage } from '@ueberblick/core';
import { fid } from '../store/run/testkit';
import { anna, bernd, ModelDevice, syncSetup, tree, vera } from './testkit';

const V = SYNC_PROTOCOL_VERSION;
const LINDE = fid(1);
const seedTrees = (ctx: ReturnType<typeof syncSetup>): void => {
  ctx.seed([
    { id: LINDE, type: 'baumart', properties: { name_de: 'Linde' } },
    {
      id: tree(1),
      type: 'baum',
      properties: { zustaendig: 'anna', stage: 'erfasst', intern_notiz: 'geheim', art: LINDE },
    },
    { id: tree(2), type: 'baum', properties: { zustaendig: 'bernd', stage: 'erfasst', art: LINDE } },
    { id: tree(3), type: 'baum', properties: { zustaendig: 'carl', stage: 'erfasst' } },
  ]);
};
const ids = (p: SyncPage): string[] => p.features.map((f) => f.id).sort();

describe('snapshot', () => {
  it('shows a participant only the features their scope admits, with rows stripped by `see`', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const page = ctx.service.page(anna, { since: 0, scope: '', v: V });
    expect(ids(page)).toEqual([LINDE, tree(1)].sort());
    expect(page.header.kind).toBe('snapshot');
    expect(page.header.more).toBe(false);
    expect(page.header.head).toBe(ctx.service.head());
    expect(page.features.find((f) => f.id === tree(1))?.properties['intern_notiz']).toBe('geheim');

    const vs = ctx.service.page(vera, { since: 0, scope: '', v: V });
    expect(ids(vs)).toEqual([LINDE, tree(1), tree(2), tree(3)].sort());
    const bs = ctx.service.page(bernd, { since: 0, scope: '', v: V });
    expect(ids(bs)).toEqual([LINDE, tree(2)].sort());
  });

  it('strips a property the role may not see from feature rows and from observations', () => {
    const ctx = syncSetup();
    ctx.seed([
      {
        id: tree(1),
        type: 'baum',
        properties: { zustaendig: 'bernd', stage: 'erfasst', intern_notiz: 'geheim' },
      },
    ]);
    const bernds = ctx.service.page(bernd, { since: 0, scope: '', v: V });
    expect(bernds.features[0]?.properties).toEqual({ zustaendig: 'bernd', stage: 'erfasst' });
    expect(bernds.observations.map((o) => o.property).sort()).toEqual(['stage', 'zustaendig']);
    const veras = ctx.service.page(vera, { since: 0, scope: '', v: V });
    expect(veras.observations.map((o) => o.property)).toContain('intern_notiz');
    expect(veras.observations.every((o) => !o.property.startsWith('$'))).toBe(true);
  });

  it('honours limit, keeps the head at the pin and leaves later changes to the delta', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const first = ctx.service.page(vera, { since: 0, scope: '', v: V, limit: 2 });
    expect(first.features).toHaveLength(2);
    expect(first.header.more).toBe(true);
    const pin = first.header.head;
    ctx.change(tree(3), { stage: 'kontrolliert' }); // after the pin
    const second = ctx.service.page(vera, {
      since: 0,
      scope: first.header.scopeFingerprint,
      v: V,
      limit: 2,
      after: first.header.cursor,
      pin,
    });
    expect(second.header.head).toBe(pin);
    expect(second.header.more).toBe(false);
    expect(second.features.map((f) => f.id)).not.toContain(tree(3)); // changed after the pin: arrives in the delta
    const delta = ctx.service.page(vera, { since: pin, scope: first.header.scopeFingerprint, v: V });
    expect(ids(delta)).toEqual([tree(3)]);
  });

  it('sends edges only between features the participant sees, and pages carry at most 10 observations per property', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    for (let i = 0; i < 14; i++) ctx.change(tree(1), { stage: i % 2 ? 'erfasst' : 'massnahme' });
    const page = ctx.service.page(anna, { since: 0, scope: '', v: V });
    expect(page.edges.map((e) => edgeKey(e))).toEqual([
      edgeKey({ from: tree(1), relation: 'art' as Key, to: LINDE }),
    ]);
    expect(page.observations.filter((o) => o.property === 'stage')).toHaveLength(10);
  });
});

describe('delta', () => {
  it('is empty and cheap when nothing changed', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const head = ctx.service.head();
    const snap = ctx.service.page(anna, { since: 0, scope: '', v: V });
    const page = ctx.service.page(anna, { since: head, scope: snap.header.scopeFingerprint, v: V });
    expect(page.header).toMatchObject({ kind: 'delta', cursor: head, head, more: false });
    expect([page.features, page.edges, page.observations, page.tombstones].every((t) => t.length === 0)).toBe(
      true,
    );
  });

  it('carries changed features and their history', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const scope = ctx.service.page(anna, { since: 0, scope: '', v: V }).header.scopeFingerprint;
    const since = ctx.service.head();
    const head = ctx.change(tree(1), { stage: 'kontrolliert' });
    ctx.change(tree(2), { stage: 'kontrolliert' }); // not anna's
    const page = ctx.service.page(anna, { since, scope, v: V });
    expect(ids(page)).toEqual([tree(1)]);
    expect(page.features[0]?.updatedSeq).toBe(head);
    expect(page.observations.some((o) => o.property === 'stage' && o.result === 'kontrolliert')).toBe(true);
  });

  it('a reassignment away produces a feature tombstone; a feature never visible produces none', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const scope = ctx.service.page(anna, { since: 0, scope: '', v: V }).header.scopeFingerprint;
    const since = ctx.service.head();
    const moved = ctx.change(tree(1), { zustaendig: 'bernd' }); // anna -> bernd: leaves anna's scope
    ctx.change(tree(3), { zustaendig: 'dora' }); // carl -> dora: never visible to anna
    const page = ctx.service.page(anna, { since, scope, v: V });
    expect(page.features.map((f) => f.id)).toEqual([]);
    expect(page.tombstones).toEqual([{ seq: moved, kind: 'feature', id: tree(1) }]);
    // and the new assignee receives the row
    const bs = ctx.service.page(bernd, {
      since,
      scope: ctx.service.page(bernd, { since: 0, scope: '', v: V }).header.scopeFingerprint,
      v: V,
    });
    expect(ids(bs)).toEqual([tree(1)]);
  });

  it('a feature that joins the scope arrives with its edges and history, though they are older than since', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const scope = ctx.service.page(anna, { since: 0, scope: '', v: V }).header.scopeFingerprint;
    const since = ctx.service.head();
    ctx.change(tree(2), { zustaendig: 'anna' });
    const page = ctx.service.page(anna, { since, scope, v: V });
    expect(ids(page)).toEqual([tree(2)]);
    expect(page.edges.map((e) => e.from)).toContain(tree(2));
    expect(page.observations.some((o) => o.property === 'stage')).toBe(true);
  });

  it('sends a tombstone for a removed edge to a device that sees both ends, never to one that does not', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    ctx.seed([{ id: fid(2), type: 'baumart', properties: { name_de: 'Eiche' } }]);
    const sa = ctx.service.page(anna, { since: 0, scope: '', v: V }).header.scopeFingerprint;
    const sb = ctx.service.page(bernd, { since: 0, scope: '', v: V }).header.scopeFingerprint;
    const since = ctx.service.head();
    ctx.change(tree(1), { art: fid(2) }); // edge tree1 -> linde removed, tree1 -> eiche put
    const key = edgeKey({ from: tree(1), relation: 'art' as Key, to: LINDE });
    const page = ctx.service.page(anna, { since, scope: sa, v: V });
    expect(page.tombstones.filter((t) => t.kind === 'edge').map((t) => t.id)).toEqual([key]);
    expect(page.edges.map((e) => e.to)).toEqual([fid(2)]);
    const other = ctx.service.page(bernd, { since, scope: sb, v: V });
    expect(other.tombstones).toEqual([]);
    expect(other.edges).toEqual([]);
  });

  it('pages a large delta by feature count and never skips a row', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const dev = new ModelDevice();
    dev.pull(ctx.service, vera, 2);
    for (const n of [1, 2, 3]) ctx.change(tree(n), { stage: 'massnahme' });
    const first = ctx.service.page(vera, { since: dev.cursor, scope: dev.scope, v: V, limit: 2 });
    expect(first.features).toHaveLength(2);
    expect(first.header.more).toBe(true);
    dev.pull(ctx.service, vera, 2);
    expect(dev.features.get(tree(3))?.properties['stage']).toBe('massnahme');
  });
});

describe('scope', () => {
  it('changes with what a participant may see, not with unrelated roles', () => {
    const ctx = syncSetup();
    const fp = (roles: string[]): string =>
      ctx.service.page({ ...anna, roles: roles as never }, { since: 0, scope: '', v: V }).header
        .scopeFingerprint;
    expect(fp(['kontrolle'])).toBe(fp(['kontrolle', 'unused']));
    expect(fp(['kontrolle'])).not.toBe(fp(['verwaltung']));
  });

  it('a stale fingerprint gets an empty page carrying the new one, so the device re-snapshots', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const page = ctx.service.page(anna, { since: 5, scope: 'stale', v: V });
    expect(page.header.scopeFingerprint).not.toBe('stale');
    expect(page.header.more).toBe(false);
    expect(page.features).toEqual([]);
    const snap = ctx.service.page(anna, { since: 0, scope: 'stale', v: V });
    expect(snap.features).toEqual([]);
    expect(snap.header.kind).toBe('snapshot');
  });
});

describe('a model device', () => {
  it('converges and drops a feature that left its scope', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const dev = new ModelDevice();
    dev.pull(ctx.service, anna);
    expect([...dev.features.keys()].sort()).toEqual([LINDE, tree(1)].sort());
    ctx.change(tree(1), { zustaendig: 'bernd' });
    dev.pull(ctx.service, anna);
    expect([...dev.features.keys()]).toEqual([LINDE]);
    expect(dev.tombstoned).toEqual([{ id: tree(1), held: true }]);
    expect(dev.edges.size).toBe(0);
  });

  it('a deleted feature arrives as a deleted row when it was in scope', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const dev = new ModelDevice();
    dev.pull(ctx.service, anna);
    ctx.change(tree(1), { $lifecycle: 'deleted' });
    dev.pull(ctx.service, anna);
    expect(dev.features.has(tree(1))).toBe(false);
  });
});

describe('lifecycle on the wire (WP-305)', () => {
  it('complete, reopen, archive: completed stays on the device, archived leaves it and Facts.ofType, admin reads keep it', () => {
    const ctx = syncSetup();
    seedTrees(ctx);
    const dev = new ModelDevice();
    dev.pull(ctx.service, anna);
    expect(dev.features.get(tree(1))?.lifecycle).toBe('active');
    ctx.change(tree(1), { $lifecycle: 'completed' });
    dev.pull(ctx.service, anna);
    expect(dev.features.get(tree(1))?.lifecycle).toBe('completed');
    ctx.change(tree(1), { $lifecycle: 'active' });
    dev.pull(ctx.service, anna);
    expect(dev.features.get(tree(1))?.lifecycle).toBe('active');
    ctx.change(tree(1), { $lifecycle: 'archived' });
    dev.pull(ctx.service, anna);
    expect(dev.features.has(tree(1))).toBe(false);
    expect(dev.tombstoned).toEqual([{ id: tree(1), held: true }]);
    // a fresh snapshot never serves it, and the Facts reads skip it
    expect(ids(ctx.service.page(anna, { since: 0, scope: '', v: V }))).toEqual([LINDE]);
    expect([...ctx.store.facts.ofType('baum' as Key)].map((f) => f.id)).not.toContain(tree(1));
    // admin reads (the table itself) still see all four states
    const row = ctx.db
      .prepare<{ lifecycle: string }>('SELECT lifecycle FROM features WHERE id = ?')
      .get(tree(1));
    expect(row?.lifecycle).toBe('archived');
    expect(ctx.store.facts.feature(tree(1))?.lifecycle).toBe('archived');
  });
});
