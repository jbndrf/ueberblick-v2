/** WP-847: the cheaper pass (one context, `self` rebound, hop reads memoised) and the sliced pass change no result. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Bbox } from '@ueberblick/core/geo';
import { condition } from '@ueberblick/core/expr';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Actor, Edge, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import { actorValue } from '@ueberblick/core/perms';
import { featureAccess } from '@ueberblick/core/plan';
import type { Facts } from '@ueberblick/core/ports';
import type { FeatureChange } from '@ueberblick/ui';
import { compile } from '../../../../../packages/core/src/schema/compile';
import { TemplateFileSchema } from '../../../../../packages/core/src/schema/file';
import { goldenAssets, goldenYaml } from '@ueberblick/core/testing';
import { ALL, type Changed } from './changed';
import { createViewSource, PASS_SLICE } from './view-source';

const WORLD: Bbox = [-180, -90, 180, 90];
const actor: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
const now = () => '2026-09-30T10:00:00.000Z' as Instant;
const geo = createGeo();
const id = (n: number) => `f${n}` as FeatureId;

function configWith(filter: string): CompiledConfig {
  const raw = structuredClone(goldenYaml('templates/baumkataster/1.0.0.yaml')) as {
    views: { alle_baeume: { source: { filter?: string } } };
  };
  raw.views.alle_baeume.source.filter = filter;
  const r = compile(TemplateFileSchema.parse(raw), { assets: goldenAssets });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

function world(trees: number, areas = 7) {
  const states = new Map<FeatureId, FeatureState>();
  const edges: Edge[] = [];
  for (let a = 0; a < areas; a++)
    states.set(id(a), {
      id: id(a),
      type: 'flaeche' as Key,
      properties: {
        geometrie: { type: 'Point', coordinates: [7, 50] },
        name: a % 3 === 0 ? 'Nord' : `Fläche ${a}`,
      } as never,
      lifecycle: 'active',
      updatedSeq: a + 1,
    });
  for (let i = 0; i < trees; i++) {
    const n = areas + i;
    states.set(id(n), {
      id: id(n),
      type: 'baum' as Key,
      properties: {
        geometrie: { type: 'Point', coordinates: [7 + (i % 50) / 100, 50 + Math.floor(i / 50) / 200] },
        stage: 'erfasst',
        vitalitaet: `v${i % 4}`,
        hoehe_m: i % 9,
      } as never,
      lifecycle: i % 11 === 0 ? 'archived' : 'active',
      updatedSeq: n + 1,
    });
    if (i % 5 !== 0)
      edges.push({ from: id(n), relation: 'flaeche' as Key, to: id(i % areas), derived: false });
  }
  const facts: Pick<Facts, 'feature' | 'near' | 'ofType' | 'edgesFrom' | 'edgesTo' | 'history'> = {
    feature: (f) => states.get(f),
    near: (t) => [...states.values()].filter((s) => s.type === t),
    ofType: (t) => [...states.values()].filter((s) => s.type === t),
    edgesFrom: (f, r) => edges.filter((e) => e.from === f && (r === undefined || e.relation === r)),
    edgesTo: (f, r) => edges.filter((e) => e.to === f && (r === undefined || e.relation === r)),
    history: () => [],
  };
  return { states, facts };
}

/** The pass as it was before WP-847: a new context and a new `featureAccess` per feature. */
function reference(w: ReturnType<typeof world>, config: CompiledConfig, filter: string): Set<FeatureId> {
  const compiled = config.expressions.get(`views.alle_baeume.source.filter`);
  const out = new Set<FeatureId>();
  for (const s of w.states.values()) {
    if (s.type !== 'baum' || s.lifecycle !== 'active' || compiled === undefined) continue;
    const ctx = {
      vars: new Map<string, never>([
        ['self', { $feature: s.id } as never],
        ['actor', actorValue(actor) as never],
      ]),
      features: featureAccess(w.facts as Facts, config),
      now: now(),
      relations: config.relations,
      geo,
    };
    if (condition(compiled.typed, ctx).value) out.add(s.id);
  }
  expect(filter).toBeTruthy();
  return out;
}

const viewOf = (
  w: ReturnType<typeof world>,
  config: CompiledConfig,
  changed: { subscribe: (fn: (c: Changed) => void) => () => void } = { subscribe: () => () => undefined },
) => createViewSource({ facts: w.facts, config, viewKey: 'alle_baeume', actor, geo, now, changed });

const atom = fc.oneof(
  fc.constantFrom('v0', 'v1', 'v2', 'v3').map((v) => `self.vitalitaet != '${v}'`),
  fc.integer({ min: 0, max: 9 }).map((h) => `self.hoehe_m != ${h}`),
  fc.constantFrom('Nord', 'Fläche 1', 'Fläche 2', 'nirgends').map((n) => `self.flaeche.name == '${n}'`),
  fc.constantFrom('Nord', 'Fläche 4').map((n) => `self.flaeche.name != '${n}'`),
);
const filterArb = fc
  .tuple(atom, fc.array(fc.tuple(fc.constantFrom('&&', '||'), atom), { maxLength: 3 }))
  .map(([a, rest]) => rest.reduce((acc, [op, x]) => `${acc} ${op} ${x}`, a));

describe('view pass: same results, cheaper per feature', () => {
  const w = world(300);
  it('shows the features the per-feature context showed, with and without a relation hop', () => {
    fc.assert(
      fc.property(filterArb, (filter) => {
        const config = configWith(filter);
        const got = new Set(
          viewOf(w, config)
            .query(WORLD)
            .map((f) => f.id),
        );
        expect(got).toEqual(reference(w, config, filter));
      }),
      { numRuns: 25 },
    );
  });

  it('slices of the pass hold the same features in the same order as the whole pass', () => {
    const config = configWith("self.flaeche.name == 'Nord' && self.vitalitaet != 'v0'");
    const source = viewOf(w, config);
    const whole = source.query(WORLD).map((f) => f.id);
    const slices = [...source.queryChunks(WORLD, 37)];
    expect(slices.length).toBeGreaterThan(1);
    expect(slices.flat().map((f) => f.id)).toEqual(whole);
  });
});

describe('view pass: a large view is delivered in slices', () => {
  const big = world(PASS_SLICE + 600);
  const config = configWith("self.vitalitaet != 'v0'");
  const wait = () => new Promise((r) => setTimeout(r, 20));
  const wanted = () => reference(big, config, 'x');
  const subscribe = (changed: { subscribe: (fn: (c: Changed) => void) => () => void }) => {
    const shown = new Set<FeatureId>();
    const changes: FeatureChange[] = [];
    const stop = viewOf(big, config, changed).subscribe(WORLD, (c) => {
      changes.push(c);
      for (const f of c.add) shown.add(f.id);
      for (const r of c.remove) shown.delete(r);
    });
    return { shown, changes, stop };
  };

  it('delivers the first slice at once and the rest after a yield; the end state is the whole view', async () => {
    const r = subscribe({ subscribe: () => () => undefined });
    expect(r.changes).toHaveLength(1);
    expect(r.shown.size).toBeLessThan(wanted().size);
    await wait();
    expect(r.shown).toEqual(wanted());
    r.stop();
  });

  it('an ALL ring while the first walk runs ends in the same view; unsubscribing stops delivery', async () => {
    let ring: (c: Changed) => void = () => undefined;
    const r = subscribe({ subscribe: (fn) => ((ring = fn), () => undefined) });
    ring(ALL);
    await wait();
    expect(r.shown).toEqual(wanted());
    const n = r.changes.length;
    const again = subscribe({ subscribe: () => () => undefined });
    again.stop();
    await wait();
    expect(again.changes).toHaveLength(1);
    expect(r.changes.length).toBe(n);
    r.stop();
  });
});
