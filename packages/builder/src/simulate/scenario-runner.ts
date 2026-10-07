/**
 * Test helper (never exported from the package): runs the part of a golden scenario the simulator
 * shows (`run` and `explain` steps) against a headless session. The full runner is WP-050's; this
 * one proves the builder's session reports what the corpus expects.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { Actor, FeatureId, Json, Key } from '@ueberblick/core';
import { openProject } from '../doc';
import { goldenProjects } from '../testing/golden';
import type { Simulation, SimulationResult } from './contract';
import { openSimulation } from './session';

const fixture = (rel: string): unknown =>
  parse(readFileSync(resolve(import.meta.dirname, '../../../../fixtures/golden', rel), 'utf8'));

interface Seed {
  participants?: Record<string, { roles: string[] }>;
  features?: Record<string, { type: string; properties: Record<string, Json> }>;
}
export interface Step {
  id: string;
  kind: string;
  task: string;
  actor?: string | { kind: Actor['kind']; id: string };
  feature?: string;
  creates?: string;
  input?: Record<string, Json>;
}
export interface Scenario {
  given: { project: string; include?: string[] } & Seed;
  when: Step[];
  then: {
    steps: Record<string, Record<string, unknown>>;
    features?: Record<string, { properties: Record<string, Json> }>;
  };
}

export interface World {
  readonly sim: Simulation;
  readonly scenario: Scenario;
  readonly ids: Map<string, FeatureId>;
  readonly actors: Map<string, Actor>;
  readonly results: Map<string, SimulationResult>;
}

export const fid = (n: number): FeatureId =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;

/** Loads a scenario, seeds its features (aliases become ids) and returns the session. */
export function loadScenario(path: string, patch?: (file: unknown) => void): World {
  const scenario = fixture(`scenarios/${path}.yaml`) as Scenario;
  const name = scenario.given.project.replace(/^projects\//, '');
  const project = goldenProjects.find((p) => p.name === name);
  if (!project) throw new Error(`no golden project ${name}`);
  const file = structuredClone(openProject(project.templateSrc, project.overlaySrc).effective());
  patch?.(file);
  const opened = openSimulation(file);
  if (!opened.ok) throw new Error(JSON.stringify(opened.problems));
  const seeds = (scenario.given.include ?? []).map((i) => fixture(i) as Seed);
  const all: Seed[] = [...seeds, scenario.given];
  const ids = new Map<string, FeatureId>();
  const actors = new Map<string, Actor>();
  let n = 100;
  const features: [string, { type: string; properties: Record<string, Json> }][] = [];
  for (const s of all) {
    for (const [alias, p] of Object.entries(s.participants ?? {}))
      actors.set(alias, { id: alias, kind: 'participant', roles: p.roles as Key[] });
    for (const [alias, f] of Object.entries(s.features ?? {})) {
      ids.set(alias, fid(++n));
      features.push([alias, f]);
    }
  }
  for (const [alias, f] of features) {
    const properties = Object.fromEntries(
      Object.entries(f.properties).map(([k, v]) => [
        k,
        typeof v === 'string' && ids.has(v) ? (ids.get(v) as string) : v,
      ]),
    );
    opened.simulation.seed([{ id: ids.get(alias) as FeatureId, type: f.type as Key, properties }]);
  }
  return { sim: opened.simulation, scenario, ids, actors, results: new Map() };
}

export function actorOf(w: World, a: Step['actor']): Actor {
  if (a === undefined) throw new Error('step has no actor');
  if (typeof a !== 'string') return { id: a.id, kind: a.kind, roles: [] };
  const actor = w.actors.get(a);
  if (!actor) throw new Error(`unknown actor ${a}`);
  return actor;
}

/** Runs one `run` step; aliases in `creates` are bound to the created feature. */
export function runStep(w: World, step: Step): SimulationResult {
  const r = w.sim.submit({
    task: step.task as Key,
    actor: actorOf(w, step.actor),
    ...(step.feature !== undefined ? { feature: w.ids.get(step.feature) as FeatureId } : {}),
    input: step.input ?? {},
  });
  if (r.ok && step.creates?.startsWith('$new:')) {
    const created = r.runs[0]?.created[0];
    if (created !== undefined) w.ids.set(step.creates.slice('$new:'.length), created);
  }
  w.results.set(step.id, r);
  return r;
}
