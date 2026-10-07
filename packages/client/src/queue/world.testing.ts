/**
 * Test world for the run queue: the golden `musterstadt-plain` project compiled, with a core `MemoryStore`
 * seeded like the plan tests do. Tests only (the same seed as `packages/core/src/plan/__fixtures__/world.ts`,
 * which other packages may not import).
 */
import { parse } from 'yaml';
import { compile, OverlayFileSchema, TemplateFileSchema, type TemplateFile } from '@ueberblick/core/schema';
import { merge } from '@ueberblick/core/template';
import { createGeo } from '@ueberblick/core/geo';
import { MemoryStore } from '@ueberblick/core/memory';
import { PLAN_MAX_RULE_DEPTH, type PlanPorts } from '@ueberblick/core';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Actor, FeatureId, Json, Key, RunId } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { goldenAssets } from '@ueberblick/core/testing';

export const NOW = '2026-05-01T08:00:00.000Z';

const raw = (g: Record<string, unknown>): [string, unknown][] =>
  Object.entries(g).map(([f, s]) => [f, parse(s as string)]);
const templates = raw(
  import.meta.glob('/fixtures/golden/templates/*/*.yaml', { query: '?raw', import: 'default', eager: true }),
).map(([f, v]) => [f, TemplateFileSchema.parse(v)] as const);
const projects = raw(
  import.meta.glob('/fixtures/golden/projects/*.yaml', { query: '?raw', import: 'default', eager: true }),
);

export function build(file: unknown): CompiledConfig {
  const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

function golden(project: string): CompiledConfig {
  const entry = projects.find(([f]) => f.endsWith(`/projects/${project}.yaml`));
  if (!entry) throw new Error(`no project ${project}`);
  const overlay = OverlayFileSchema.parse(entry[1]);
  const [name, major] = overlay.extends.split('@');
  const found = templates
    .filter(([f, t]) => f.includes(`/${name}/`) && t.template.version.startsWith(`${major}.`))
    .map(([, t]) => t)
    .sort((a, b) => a.template.version.localeCompare(b.template.version, 'en', { numeric: true }));
  const base = found[found.length - 1] as TemplateFile;
  return build(merge(base, overlay).file);
}

export const anna: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
export const fid = (n: number): FeatureId =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
export const rid = (n: number): RunId => `10000000-0000-7000-8000-${String(n).padStart(12, '0')}` as RunId;

/** The config version the harness store folds under. */
const WORLD_CONFIG_VERSION = 1;

export class World extends MemoryStore {
  constructor(config: CompiledConfig) {
    super(config, { now: () => NOW }, createGeo(), WORLD_CONFIG_VERSION);
  }

  add(id: FeatureId, type: string, properties: Readonly<Record<string, Json>>): FeatureId {
    this.append(rid(0), [
      { featureId: id, property: '$type', result: type },
      ...Object.entries(properties).map(([property, result]) => ({ featureId: id, property, result })),
    ]);
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

export const IDS = { park: fid(1), linde: fid(2), t_in: fid(3), t_hole: fid(4), t_out: fid(5) } as const;

const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

export function musterstadt(): { config: CompiledConfig; world: World } {
  // the golden `write` map of baum omits hoehe_m and hoehe_klasse, which every kontrolle run writes
  const g = golden('musterstadt-plain');
  const file = structuredClone(g.file) as unknown as {
    types: { baum: { permissions: { write: Record<string, string[]> } } };
  };
  file.types.baum.permissions.write['hoehe_m'] = ['kontrolle'];
  file.types.baum.permissions.write['hoehe_klasse'] = ['kontrolle'];
  const config = build(file);
  const w = new World(config);
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
