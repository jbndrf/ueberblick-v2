/**
 * WP-594: the golden scenario `roles/own_lists_without_position`, run against the participant's list. The golden
 * runner does not execute `view` steps yet, so this spec reads the scenario and checks each `view` step's `ids`
 * against `createViewList` (the same data, the same filter, no geometry needed).
 */
import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureState, Instant, Key } from '@ueberblick/core/model';
import { goldenConfig, goldenYaml } from '@ueberblick/core/testing';
import { createViewList } from './view-source';

interface SeedFeature {
  readonly type: string;
  readonly properties?: Record<string, unknown>;
}
interface Doc {
  readonly given: {
    readonly project: string;
    readonly include: readonly string[];
    readonly features: Record<string, SeedFeature>;
    readonly participants: Record<string, { readonly roles: readonly string[] }>;
  };
  readonly when: readonly {
    readonly id: string;
    readonly kind: string;
    readonly view: string;
    readonly actor: string;
  }[];
  readonly then: { readonly steps: Record<string, { readonly ids: readonly string[] }> };
}
interface Seed {
  readonly participants?: Record<string, { readonly roles: readonly string[] }>;
  readonly features?: Record<string, SeedFeature>;
}

const scenario = goldenYaml('scenarios/roles/own_lists_without_position.yaml') as unknown as Doc;
const config = goldenConfig(scenario.given.project);
const seeds = scenario.given.include.map((p) => goldenYaml(p) as unknown as Seed);
const roles = Object.assign({}, ...seeds.map((s) => s.participants ?? {})) as Record<
  string,
  { readonly roles: readonly string[] }
>;
Object.assign(roles, scenario.given.participants);
const declared = Object.assign({}, ...seeds.map((s) => s.features ?? {}), scenario.given.features) as Record<
  string,
  SeedFeature
>;
const states: FeatureState[] = Object.entries(declared).map(
  ([id, f], i) =>
    ({ id, type: f.type, properties: f.properties ?? {}, lifecycle: 'active', updatedSeq: i + 1 }) as never,
);
const facts = {
  feature: (id: string) => states.find((s) => s.id === id),
  near: () => [], // the map's index never holds a feature without geometry
  ofType: (t: Key) => states.filter((s) => s.type === t),
  edgesFrom: () => [],
  edgesTo: () => [],
  history: () => [],
};
/** The ids the scenario expects for `step`; a missing expectation is a spec error, never a silently empty list. */
const expected = (step: string): readonly string[] => {
  const s = scenario.then.steps[step];
  if (s === undefined) throw new Error(`no then expectation for step ${step}`);
  return s.ids;
};

describe('golden scenario own_lists_without_position', () => {
  it('lists view steps and exactly one then expectation per step', () => {
    expect(scenario.when.length).toBeGreaterThan(0);
    for (const s of scenario.when) expect(s.kind).toBe('view');
    const ids = scenario.when.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(scenario.then.steps).sort()).toEqual([...ids].sort());
  });
  for (const step of scenario.when) {
    it(`${step.id}: ${step.actor} on ${step.view}`, () => {
      const actor: Actor = {
        id: step.actor,
        kind: 'participant',
        roles: (roles[step.actor]?.roles ?? []) as readonly Key[],
      };
      const rows = createViewList({
        facts: facts as never,
        config,
        viewKey: step.view,
        actor,
        geo: createGeo(),
        now: () => '2026-05-01T08:00:00.000Z' as Instant,
        locales: ['de'],
      }).rows();
      expect(rows.map((r) => r.id).sort()).toEqual([...expected(step.id)].sort());
    });
  }
});
