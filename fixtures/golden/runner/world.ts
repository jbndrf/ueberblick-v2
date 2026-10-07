/** Scenario world: config, seeds, participants and the server the steps run against. */
import type { Actor, Key } from '../../../packages/core/src/model';
import { createGeo } from '../../../packages/core/src/geo';
import { compilePerms } from '../../../packages/core/src/perms';
import { PLAN_MAX_RULE_DEPTH, type PlanLimits } from '../../../packages/core/src/plan';
import {
  Aliases,
  createClock,
  goldenConfig,
  goldenYaml,
  seedFeatures,
  type FakeClock,
  type ScenarioServer,
  type ScenarioServerFactory,
  type SeedFeatures,
  simServerFactory,
} from '../../../packages/core/src/testing';
import { isRec, type Rec } from './match';

export interface ScenarioDoc {
  readonly scenario: string;
  readonly title: string;
  readonly given: Rec;
  readonly when: readonly Rec[];
  readonly then: Rec;
}

export interface ScenarioWorld {
  readonly server: ScenarioServer;
  readonly aliases: Aliases;
  readonly clock: FakeClock;
  readonly participants: Map<string, Actor>;
  actor(ref: unknown): Actor;
}

const asRec = (v: unknown): Rec => (isRec(v) ? v : {});

/** `given.platform` overrides of the platform limits handed to plan. */
function platformLimits(platform: Rec): PlanLimits {
  const depth = platform['rule_depth_limit'];
  return { ruleDepth: typeof depth === 'number' ? depth : PLAN_MAX_RULE_DEPTH };
}

export function buildWorld(doc: ScenarioDoc, make: ScenarioServerFactory = simServerFactory): ScenarioWorld {
  const given = doc.given;
  const path = (given['project'] ?? given['template']) as string;
  const config = goldenConfig(path);
  const perms = compilePerms(config);
  const clock = createClock((given['now'] as string | undefined) ?? '2026-05-01T08:00:00.000Z');
  const server = make(config, perms, clock, createGeo(), platformLimits(asRec(given['platform'])));
  const aliases = new Aliases();

  // Seeds first, then the scenario's own entries (merged by alias).
  const features: Record<string, unknown> = {};
  const people: Record<string, unknown> = {};
  for (const inc of (given['include'] as string[] | undefined) ?? []) {
    const seed = asRec(goldenYaml(inc));
    Object.assign(people, asRec(seed['participants']));
    Object.assign(features, asRec(seed['features']));
  }
  Object.assign(people, asRec(given['participants']));
  Object.assign(features, asRec(given['features']));

  const participants = new Map<string, Actor>();
  for (const [id, v] of Object.entries(people)) {
    const roles = ((asRec(v)['roles'] as string[] | undefined) ?? []) as unknown as readonly Key[];
    participants.set(id, { id, kind: 'participant', roles });
  }
  server.seed((store) => seedFeatures(store, features as SeedFeatures, aliases));

  return {
    server,
    aliases,
    clock,
    participants,
    actor(ref) {
      if (typeof ref === 'string') {
        const a = participants.get(ref);
        if (!a) throw new Error(`unknown participant alias "${ref}"`);
        return a;
      }
      const r = asRec(ref);
      return { id: String(r['id']), kind: r['kind'] as Actor['kind'], roles: [] };
    },
  };
}
