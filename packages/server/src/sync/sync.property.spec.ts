/**
 * Property: for random runs and permissions, a snapshot followed by deltas (random page sizes, pulls at random
 * points) leaves every device holding exactly what the server shows that participant. Also: a feature tombstone is
 * only ever sent for a feature the device holds, so features that were never visible never appear, not even as one.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  actorValue,
  createGeo,
  edgeKey,
  featureAccess,
  type Actor,
  type CompiledConfig,
  type FeatureId,
  type FeatureState,
  type Json,
  type Key,
} from '@ueberblick/core';
import { compilePerms } from '@ueberblick/core';
import { NOW, fid } from '../store/run/testkit';
import { createFacts, inverseRelations } from '../store';
import {
  anna,
  bernd,
  ModelDevice,
  RELATION_VISIBLE_WHEN,
  scopedConfig,
  syncSetup,
  tree,
  vera,
  type SyncCtx,
} from './testkit';

const actors: readonly Actor[] = [anna, bernd, vera];
const LINDE = fid(1);
const EICHE = fid(2);

type Values = Readonly<Record<string, Json>>;
type Op =
  | { readonly op: 'set'; readonly n: number; readonly values: Values }
  | { readonly op: 'delete'; readonly n: number }
  | { readonly op: 'pull'; readonly who: number; readonly limit: number };

const who = fc.constantFrom('anna', 'bernd', 'carl');
const values = fc.record(
  {
    zustaendig: who,
    stage: fc.constantFrom('erfasst', 'kontrolliert', 'massnahme'),
    intern_notiz: fc.string({ maxLength: 4 }),
    art: fc.constantFrom<Json>(LINDE, EICHE, null),
  },
  { requiredKeys: [] },
) as fc.Arbitrary<Values>;
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ op: fc.constant('set' as const), n: fc.nat(5), values }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('delete' as const), n: fc.nat(5) }) },
  {
    weight: 3,
    arbitrary: fc.record({
      op: fc.constant('pull' as const),
      who: fc.nat(2),
      limit: fc.integer({ min: 1, max: 4 }),
    }),
  },
);

/** What the server shows `actor`: the in-memory permission check over every stored feature. */
function oracle(ctx: SyncCtx, config: CompiledConfig, actor: Actor) {
  const perms = compilePerms(config);
  const facts = createFacts(ctx.db, inverseRelations(config));
  const ctxOf = {
    vars: new Map([['actor', actorValue(actor)]]),
    features: featureAccess(facts, config),
    now: NOW,
    relations: config.relations,
    geo: createGeo(),
  };
  const subjects = perms.subjects(actor);
  const rows = ctx.db
    .prepare<{ id: string; type: string; properties: string; updated_seq: number }>(
      "SELECT id, type, properties, updated_seq FROM features WHERE lifecycle IN ('active','completed')",
    )
    .all();
  const features = new Map<string, Json>();
  for (const r of rows) {
    const t = perms.forType(r.type as Key);
    const state: FeatureState = {
      id: r.id as FeatureId,
      type: r.type as FeatureState['type'],
      properties: JSON.parse(r.properties) as FeatureState['properties'],
      lifecycle: 'active',
      updatedSeq: r.updated_seq,
    };
    if (t === undefined || !t.canSee(subjects, state, ctxOf).ok) continue;
    const ok = t.readable(subjects);
    features.set(
      r.id,
      Object.fromEntries(Object.entries(state.properties).filter(([k]) => ok.has(k))) as Json,
    );
  }
  const edges = new Set<string>();
  for (const e of ctx.db
    .prepare<{ from_id: string; relation: string; to_id: string }>(
      'SELECT from_id, relation, to_id FROM edges',
    )
    .all()) {
    if (!features.has(e.from_id) || !features.has(e.to_id)) continue;
    const type = rows.find((r) => r.id === e.from_id)?.type ?? '';
    const prop = config.file.types?.[type]?.properties ?? {};
    if (
      e.relation in prop &&
      !perms
        .forType(type as Key)
        ?.readable(subjects)
        .has(e.relation)
    )
      continue;
    edges.add(
      edgeKey({ from: e.from_id as FeatureId, relation: e.relation as never, to: e.to_id as FeatureId }),
    );
  }
  return { features, edges };
}

/** A row filter on the feature's own properties, and one through a relation (`self.art.name_de`). */
describe.each([
  { name: 'own properties', config: scopedConfig() },
  { name: 'through a relation', config: scopedConfig(RELATION_VISIBLE_WHEN) },
])('sync property, visible_when over $name', ({ config }) => {
  const perms = compilePerms(config);
  it('snapshot then deltas equal the server state visible to each participant', () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 30 }), (ops) => {
        const ctx = syncSetup(config);
        ctx.seed([
          { id: LINDE, type: 'baumart', properties: { name_de: 'Linde' } },
          { id: EICHE, type: 'baumart', properties: { name_de: 'Eiche' } },
        ]);
        const devices = actors.map(() => new ModelDevice());
        const created = new Set<number>();
        const ever = actors.map(() => new Set<string>()); // ids each actor could ever have seen
        const note = (): void =>
          actors.forEach((a, i) => oracle(ctx, config, a).features.forEach((_, id) => ever[i]?.add(id)));
        for (const o of ops) {
          if (o.op === 'pull') {
            const a = actors[o.who] as Actor;
            (devices[o.who] as ModelDevice).pull(ctx.service, a, o.limit);
          } else if (o.op === 'delete') {
            if (created.has(o.n)) ctx.change(tree(o.n), { $lifecycle: 'deleted' });
            note();
          } else {
            const first = !created.has(o.n);
            created.add(o.n);
            ctx.change(tree(o.n), { ...(first ? { $type: 'baum' } : { $lifecycle: 'active' }), ...o.values });
            note();
          }
        }
        actors.forEach((a, i) => {
          const dev = devices[i] as ModelDevice;
          dev.pull(ctx.service, a);
          const want = oracle(ctx, config, a);
          const have = new Map<string, Json>([...dev.features].map(([id, f]) => [id, f.properties as Json]));
          expect(have).toEqual(want.features);
          // a deleted feature keeps its reference edges on the server and on the device; compare live ends only
          const live = new Set(
            [...dev.edges].filter((k) => {
              const [from, , to] = k.split('\u0000');
              return dev.features.has(from as string) && dev.features.has(to as string);
            }),
          );
          expect(live).toEqual(want.edges);
          // a tombstone only ever names a feature that was in this participant's scope at some time
          expect(dev.tombstoned.every((t) => ever[i]?.has(t.id))).toBe(true);
          // no observation of a property the actor may not read, on any page
          for (const p of dev.pages)
            for (const ob of p.observations) {
              const type = dev.features.get(ob.featureId)?.type;
              if (type !== undefined)
                expect(
                  perms
                    .forType(type as Key)
                    ?.readable(perms.subjects(a))
                    .has(ob.property),
                ).toBe(true);
            }
        });
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
