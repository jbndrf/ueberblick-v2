/**
 * Sync per version (A-029 §4, WP-316): the live set, per-version visibility and readable properties, row `version`,
 * header `versions`, the fingerprint over the live set, and zero pins = the pre-pinning output.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  edgeKey,
  compilePerms,
  SYNC_PROTOCOL_VERSION,
  type Actor,
  type CompiledConfig,
  type FeatureId,
  type Key,
  type TemplateFile,
} from '@ueberblick/core';
import { build, fid, golden, NOW } from '../store/run/testkit';
import { LIVE_PINS } from './live';
import { createResolvedScopes } from './visibility';
import { withActivityNames } from './runs';
import { anna, bernd, ModelDevice, scopedConfig, syncSetup, tree, vera, VISIBLE_WHEN } from './testkit';

const V = SYNC_PROTOCOL_VERSION;
/** v1: own trees (and verwaltung); the note is readable for kontrolle and verwaltung. */
const v1 = (): CompiledConfig => scopedConfig(VISIBLE_WHEN, ['kontrolle', 'verwaltung']);
/** v2: only trees of carl; the note is readable for verwaltung only. */
const v2 = (): CompiledConfig => scopedConfig("self.zustaendig == 'carl'", ['verwaltung']);

const world = (deployed = 2) =>
  syncSetup(v1(), { now: () => NOW }, { configs: new Map([[2, v2()]]), deployed });

type World = ReturnType<typeof world>;

const seedFour = (ctx: World): void => {
  ctx.seed([
    { id: tree(1), type: 'baum', properties: { zustaendig: 'anna', stage: 'erfasst', intern_notiz: 'n1' } },
    { id: tree(2), type: 'baum', properties: { zustaendig: 'anna', stage: 'erfasst', intern_notiz: 'n2' } },
    { id: tree(3), type: 'baum', properties: { zustaendig: 'carl', stage: 'erfasst', intern_notiz: 'n3' } },
    { id: tree(4), type: 'baum', properties: { zustaendig: 'carl', stage: 'erfasst', intern_notiz: 'n4' } },
  ]);
  ctx.pin(tree(1), 1);
  ctx.pin(tree(3), 1);
};

const snapshot = (ctx: World, who: Actor) => ctx.service.page(who, { since: 0, scope: '', v: V });
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe('visibility per version', () => {
  it('a pinned feature is visible under its own version only, a floating one under the deployed version', () => {
    const ctx = world();
    seedFour(ctx);
    // anna: v1 sees her own trees, v2 sees carl's. t1 pinned v1 (own: yes), t2 floating v2 (anna's: no),
    // t3 pinned v1 (carl's: no), t4 floating v2 (carl's: yes).
    expect(sorted(snapshot(ctx, anna).features.map((f) => f.id))).toEqual(sorted([tree(1), tree(4)]));
    // vera sees everything under v1 (t1, t3 pinned) and, under v2, only carl's floating t4.
    expect(sorted(snapshot(ctx, vera).features.map((f) => f.id))).toEqual(
      sorted([tree(1), tree(3), tree(4)]),
    );
  });

  it('the delta decides the same way, and a pin change moves a feature into sight', () => {
    const ctx = world();
    seedFour(ctx);
    const d = new ModelDevice();
    d.pull(ctx.service, anna);
    expect(sorted([...d.features.keys()])).toEqual(sorted([tree(1), tree(4)]));
    ctx.pin(tree(2), 1);
    ctx.change(tree(2), { beschreibung: 'x' }); // bumps updated_seq so the delta reads the row again
    d.pull(ctx.service, anna);
    expect(d.features.has(tree(2))).toBe(true);
  });

  it('visible() is the union of the per-version predicates (the OGC filter)', () => {
    const ctx = world();
    seedFour(ctx);
    const p = ctx.service.visible(anna, 'f');
    const rows = ctx.db
      .prepare<{ id: string }>(`SELECT f.id FROM features f WHERE f.type = 'baum' AND ${p.sql}`)
      .all(...(p.params as (string | number)[]));
    expect(sorted(rows.map((r) => r.id))).toEqual(sorted([tree(1), tree(4)]));
  });
});

describe('readable properties per row version', () => {
  it('is sent for a v1-pinned row and redacted for a v2 row (rows and observations)', () => {
    const ctx = world();
    // anna sees tree 1 under v1 (her own) and tree 2 under v2 (carl's); the note is readable for her in v1 only.
    ctx.seed([
      { id: tree(1), type: 'baum', properties: { zustaendig: 'anna', stage: 'erfasst', intern_notiz: 'a' } },
      { id: tree(2), type: 'baum', properties: { zustaendig: 'carl', stage: 'erfasst', intern_notiz: 'b' } },
    ]);
    ctx.pin(tree(1), 1);
    const page = snapshot(ctx, anna);
    const by = (id: FeatureId) => page.features.find((f) => f.id === id);
    expect(by(tree(1))?.properties['intern_notiz']).toBe('a');
    expect(by(tree(1))?.version).toBe(1);
    expect(by(tree(2))?.properties['intern_notiz']).toBeUndefined();
    expect(by(tree(2))?.version).toBe(2);
    const notes = page.observations.filter((o) => o.property === 'intern_notiz').map((o) => o.featureId);
    expect(notes).toEqual([tree(1)]);
  });
});

describe('relation edges across versions', () => {
  const LINDE = fid(1);
  const EICHE = fid(2);
  /** v2 hides every Baumart but the Eiche, so the Linde is visible only under v1's (unfiltered) rules. */
  const v2Hidden = (): CompiledConfig => {
    const file = golden('musterstadt-plain').file;
    const baumart = file.types?.['baumart'];
    if (baumart === undefined) throw new Error('golden template has no baumart');
    const hidden: TemplateFile = {
      ...file,
      types: {
        ...file.types,
        baumart: {
          ...baumart,
          permissions: { ...baumart.permissions, visible_when: "self.name_de == 'Eiche'" },
        },
      },
    };
    return build(hidden);
  };
  const edgeWorld = () => {
    const v1c = scopedConfig(VISIBLE_WHEN);
    return syncSetup(v1c, { now: () => NOW }, { configs: new Map([[2, v2Hidden()]]), deployed: 2 });
  };
  const seed = (ctx: ReturnType<typeof edgeWorld>): void => {
    ctx.seed([
      { id: LINDE, type: 'baumart', properties: { name_de: 'Linde' } },
      { id: EICHE, type: 'baumart', properties: { name_de: 'Eiche' } },
      { id: tree(1), type: 'baum', properties: { zustaendig: 'anna', stage: 'erfasst', art: LINDE } },
    ]);
    ctx.pin(tree(1), 1);
  };
  const key = (to: FeatureId): string => edgeKey({ from: tree(1), relation: 'art' as Key, to });

  it('is sent only when both ends are visible, each under its own version', () => {
    const ctx = edgeWorld();
    seed(ctx);
    // tree 1 follows v1 (visible), the floating Linde follows v2 (hidden): no edge.
    expect(snapshot(ctx, anna).edges).toEqual([]);
    ctx.pin(LINDE, 1); // now the Linde follows v1 too
    expect(snapshot(ctx, anna).edges.map((e) => edgeKey(e))).toEqual([key(LINDE)]);
  });

  it('a removed edge is tombstoned for a device that sees both ends under their own versions, else not', () => {
    const ctx = edgeWorld();
    seed(ctx);
    const scope = snapshot(ctx, anna).header.scopeFingerprint;
    const since = ctx.service.head();
    ctx.change(tree(1), { art: EICHE }); // tree1 -> linde removed
    const hiddenEnd = ctx.service.page(anna, { since, scope, v: V });
    expect(hiddenEnd.tombstones.filter((t) => t.kind === 'edge')).toEqual([]);

    const ctx2 = edgeWorld();
    seed(ctx2);
    ctx2.pin(LINDE, 1);
    const scope2 = snapshot(ctx2, anna).header.scopeFingerprint;
    const since2 = ctx2.service.head();
    ctx2.change(tree(1), { art: EICHE });
    const both = ctx2.service.page(anna, { since: since2, scope: scope2, v: V });
    expect(both.tombstones.filter((t) => t.kind === 'edge').map((t) => t.id)).toEqual([key(LINDE)]);
  });
});

describe('wire', () => {
  it('rows carry version, the header lists deployed and the live set', () => {
    const ctx = world();
    seedFour(ctx);
    const page = snapshot(ctx, vera);
    expect(page.header.versions).toEqual({ deployed: 2, live: [1, 2] });
    expect(Object.fromEntries(page.features.map((f) => [f.id, f.version]))).toEqual({
      [tree(1)]: 1,
      [tree(3)]: 1,
      [tree(4)]: 2,
    });
    const delta = ctx.service.page(vera, { since: 1, scope: '', v: V });
    expect(delta.header.versions).toEqual({ deployed: 2, live: [1, 2] });
  });

  it('the fingerprint changes when the live set changes, and a stale device gets the empty re-snapshot page', () => {
    const ctx = world();
    seedFour(ctx);
    const withPins = snapshot(ctx, vera).header.scopeFingerprint;
    ctx.pin(tree(1), null);
    ctx.pin(tree(3), null);
    const floating = snapshot(ctx, vera);
    expect(floating.header.versions).toEqual({ deployed: 2, live: [2] });
    expect(floating.header.scopeFingerprint).not.toBe(withPins);
    const stale = ctx.service.page(vera, { since: 0, scope: withPins, v: V });
    expect(stale.features).toEqual([]);
    expect(stale.header.scopeFingerprint).toBe(floating.header.scopeFingerprint);
  });
});

describe('live set', () => {
  it('is read with index probes on features_pinned, not a scan of the features', () => {
    const ctx = world();
    seedFour(ctx);
    const plan = ctx.db
      .prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${LIVE_PINS}`)
      .all()
      .map((r) => r.detail);
    expect(plan.filter((d) => /SCAN features/.test(d))).toEqual([]);
    expect(plan.some((d) => /features_pinned/.test(d))).toBe(true);
  });
});

describe('zero pins', () => {
  it('property: with no pins the live set is the deployed version and nothing but the new fields differs', () => {
    const who = [anna, bernd, vera];
    const config = v2();
    const resolved = { version: 2, config, perms: compilePerms(config) };
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            n: fc.nat(5),
            zustaendig: fc.constantFrom('anna', 'bernd', 'carl'),
            note: fc.string({ maxLength: 3 }),
          }),
          { maxLength: 8 },
        ),
        fc.nat(2),
        (rows, a) => {
          const ctx = world();
          for (const r of rows)
            ctx.change(tree(r.n + 1), {
              $type: 'baum',
              zustaendig: r.zustaendig,
              stage: 'erfasst',
              intern_notiz: r.note,
            });
          const actor = who[a] as Actor;
          const page = snapshot(ctx, actor);
          // The pre-pinning scope of the deployed version, from the single-version builders.
          const scope = withActivityNames(createResolvedScopes()(actor, resolved));
          expect(page.header.scopeFingerprint).toBe(scope.fingerprint);
          expect(page.header.versions).toEqual({ deployed: 2, live: [2] });
          expect(page.features.every((f) => f.version === 2)).toBe(true);
          const old = scope.visibleSql('f', NOW);
          expect(ctx.service.visible(actor, 'f')).toEqual(old);
          const ids = ctx.db
            .prepare<{ id: string }>(
              `SELECT f.id FROM features f WHERE f.lifecycle = 'active' AND ${old.sql}`,
            )
            .all(...(old.params as (string | number)[]))
            .map((r) => r.id);
          expect(sorted(page.features.map((f) => f.id))).toEqual(sorted(ids));
        },
      ),
      { numRuns: 40 },
    );
  });
});
