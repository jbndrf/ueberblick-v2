/** Test world for plan: golden configs, an in-memory `Facts` seeded through core.fold, ports and actors. */
import { parse } from 'yaml';
import { createGeo } from '../../geo';
import { MemoryStore } from '../../memory';
import { merge } from '../../template';
import type { Actor, FeatureId, Json, Key, RunId } from '../../model';
import { compilePerms } from '../../perms';
import type { Facts } from '../../ports';
import { compile } from '../../schema/compile';
import type { CompiledConfig } from '../../schema/compile/contract';
import { OverlayFileSchema, TemplateFileSchema, type TemplateFile } from '../../schema/file';
import { PLAN_MAX_RULE_DEPTH, type PlanPorts, type RulePorts } from '../contract';
import { goldenAssets } from '../../testing/golden';
import { everyone } from '../../perms/who';

export const NOW = '2026-05-01T08:00:00.000Z';

const raw = (g: Record<string, unknown>): [string, unknown][] =>
  Object.entries(g).map(([f, s]) => [f, parse(s as string)]);
const templates = raw(
  import.meta.glob('/fixtures/golden/templates/*/*.yaml', { query: '?raw', import: 'default', eager: true }),
).map(([f, v]) => [f, TemplateFileSchema.parse(v)] as const);
const projects = raw(
  import.meta.glob('/fixtures/golden/projects/*.yaml', { query: '?raw', import: 'default', eager: true }),
);

/** Compiles a file as it is. */
export function buildRaw(file: unknown): CompiledConfig {
  const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

/** Compiles a hand-made file; its tasks without `who` are open to every role (`everyone`, C-004 step 3). */
export const build = (file: unknown): CompiledConfig => buildRaw(everyone(structuredClone(file)));

/** A golden project (`musterstadt-plain`, …) merged onto its newest template of the extended major. */
export function golden(project: string): CompiledConfig {
  const entry = projects.find(([f]) => f.endsWith(`/projects/${project}.yaml`));
  if (!entry) throw new Error(`no project ${project}`);
  const overlay = OverlayFileSchema.parse(entry[1]);
  const [name, major] = overlay.extends.split('@');
  const found = templates
    .filter(([f, t]) => f.includes(`/${name}/`) && t.template.version.startsWith(`${major}.`))
    .map(([, t]) => t)
    .sort((a, b) => a.template.version.localeCompare(b.template.version, 'en', { numeric: true }));
  const base = found[found.length - 1] as TemplateFile;
  return buildRaw(merge(base, overlay).file);
}

export const actor = (kind: Actor['kind'], id: string, roles: readonly string[] = []): Actor => ({
  id,
  kind,
  roles: roles as readonly Key[],
});
export const anna = actor('participant', 'anna', ['kontrolle']);
export const bernd = actor('participant', 'bernd', ['bauhof']);
export const vera = actor('participant', 'vera', ['verwaltung']);

export const fid = (n: number): FeatureId =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
export const rid = (n: number): RunId => `10000000-0000-7000-8000-${String(n).padStart(12, '0')}` as RunId;

/** The config version the harness store folds under. */
const WORLD_CONFIG_VERSION = 1;

/** The harness store (`MemoryStore`, R1) with a seeding helper: an import, no permissions, no task. */
export class World extends MemoryStore {
  constructor(config: CompiledConfig) {
    super(config, { now: () => NOW }, createGeo(), WORLD_CONFIG_VERSION);
  }

  /** Seed one feature; the store folds it and derives its edges like the adapters do. */
  add(id: FeatureId, type: string, properties: Readonly<Record<string, Json>>): FeatureId {
    this.append(rid(0), [
      { featureId: id, property: '$type', result: type },
      ...Object.entries(properties).map(([property, result]) => ({ featureId: id, property, result })),
    ]);
    if (this.features.get(id) === undefined) throw new Error('seed did not create a feature');
    return id;
  }
}

export function ports(world: Facts): PlanPorts & { counter: { n: number } } {
  const counter = { n: 1000 };
  return {
    counter,
    clock: { now: () => NOW },
    facts: world,
    geo: createGeo(),
    limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
  };
}

/** `ports` plus the ids port of a timer rule run (`fireRuleFor`). */
export function rulePorts(world: Facts): RulePorts & { counter: { n: number } } {
  const p = ports(world);
  return {
    ...p,
    ids: { runId: () => rid(++p.counter.n), featureId: () => fid(++p.counter.n) },
  };
}

export const permsOf = compilePerms;

/** The seeded park and trees of `fixtures/golden/seeds/musterstadt-geo.yaml` (ids stable across tests). */
export const IDS = { park: fid(1), linde: fid(2), t_in: fid(3), t_hole: fid(4), t_out: fid(5) } as const;

export function musterstadt(): { config: CompiledConfig; world: World } {
  // The golden `write` map of baum omits hoehe_m and hoehe_klasse, which every kontrolle run writes
  // (hoehe_klasse is always computed): patched here so the task can succeed (reported to the lead, see the WP log).
  const g = golden('musterstadt-plain');
  const file = structuredClone(g.file) as unknown as {
    types: { baum: { permissions: { write: Record<string, string[]> } } };
  };
  file.types.baum.permissions.write['hoehe_m'] = ['kontrolle'];
  file.types.baum.permissions.write['hoehe_klasse'] = ['kontrolle'];
  const config = buildRaw(file);
  const w = new World(config);
  const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  w.add(IDS.linde, 'baumart', { name_de: 'Linde', name_lat: 'Tilia' });
  w.add(IDS.park, 'flaeche', {
    name: 'Spielplatz Nord',
    geometrie: {
      type: 'Polygon',
      coordinates: [square(7.1, 50.73, 7.11, 50.74), square(7.104, 50.734, 7.106, 50.736)],
    },
  });
  w.add(IDS.t_in, 'baum', {
    geometrie: { type: 'Point', coordinates: [7.102, 50.732] },
    art: IDS.linde,
    stage: 'erfasst',
    vitalitaet: 'v2',
    befund: 'unauffällig',
    zustaendig: 'anna',
    faellig_am: '2026-04-01',
    intern_notiz: 'Wurzelschaden prüfen',
  });
  w.add(IDS.t_hole, 'baum', {
    geometrie: { type: 'Point', coordinates: [7.105, 50.735] },
    stage: 'erfasst',
    vitalitaet: 'v1',
  });
  w.add(IDS.t_out, 'baum', {
    geometrie: { type: 'Point', coordinates: [7.12, 50.75] },
    stage: 'erfasst',
    vitalitaet: 'v4',
    faellig_am: '2026-06-01',
  });
  return { config, world: w };
}
