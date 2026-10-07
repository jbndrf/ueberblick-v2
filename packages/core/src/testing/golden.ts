/**
 * Loading the golden corpus (fixtures/golden) for tests and the scenario runner: configs compiled
 * through the real `template.merge` and `compile`, seeds applied as imports. Vite-only (`import.meta.glob`).
 */
import { parse, parseDocument, visit, type YAMLMap } from 'yaml';
import type { FeatureId, Json, Observation } from '../model';
import { merge } from '../template';
import { compile, embedRefs, type AssetResolver } from '../schema/compile';
import type { CompiledConfig } from '../schema/compile/contract';
import { OverlayFileSchema, TemplateFileSchema, type TemplateFile } from '../schema/file';
import { SEED_RUN } from './ids';
import type { MemoryStore } from '../memory';

const sources = import.meta.glob('/fixtures/golden/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const jsonSources = import.meta.glob('/fixtures/golden/**/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const svgSources = import.meta.glob('/fixtures/golden/**/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The corpus as a project bundle: resolves `styles/<name>.json` (WP-577) and `icons/<name>.svg` (the SVG text, WP-674) for `compile(file, { assets })`. */
export const goldenAssets: AssetResolver = (ref) => {
  const svg = svgSources[`/fixtures/golden/${ref}`];
  if (svg !== undefined) return svg;
  const text = jsonSources[`/fixtures/golden/${ref}`];
  return text === undefined ? undefined : JSON.parse(text);
};

/** `value` with every `{ $ref }` object replaced by its bundle file (a template or an overlay may hold them). */
export const embedGoldenRefs = <T>(value: T): T => embedRefs(value, goldenAssets);

/** Embedding is pure and fixture loaders (and property tests) call it often: each source is embedded once. */
const embedded = new Map<string, string>();

/**
 * A golden template or overlay source with its `$ref` styles embedded, as an ingestion point stores it
 * (B-013): fixture loaders hand this to code that compiles with `NO_ASSETS`. Comments and key order stay.
 */
export function embedGoldenSource(src: string): string {
  const cached = embedded.get(src);
  if (cached !== undefined) return cached;
  const doc = parseDocument(src);
  visit(doc, {
    Map(_key, node) {
      const ref = node.get('$ref');
      if (typeof ref !== 'string') return undefined;
      return doc.createNode(embedRefs(node.toJSON() as object, goldenAssets)) as YAMLMap; // siblings of `$ref` (an icon's size) stay
    },
  });
  const out = doc.toString();
  embedded.set(src, out);
  return out;
}

/** Parsed yaml of a corpus file, by path relative to `fixtures/golden/` (e.g. `seeds/musterstadt-geo.yaml`). */
export function goldenYaml(path: string): unknown {
  const text = sources[`/fixtures/golden/${path}`];
  if (text === undefined) throw new Error(`golden file not found: ${path}`);
  return parse(text);
}

/** Every corpus file path under `dir` (relative to `fixtures/golden/`), sorted. */
export function goldenFiles(dir: string): string[] {
  const prefix = `/fixtures/golden/${dir}/`;
  return Object.keys(sources)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice('/fixtures/golden/'.length))
    .sort();
}

/** The newest corpus template of `name` whose version starts with `major.` (throws when none). */
export const newestTemplate = (name: string, major: string): TemplateFile => {
  const found = goldenFiles(`templates/${name}`)
    .map((f) => TemplateFileSchema.parse(goldenYaml(f)))
    .filter((t) => t.template.version.startsWith(`${major}.`))
    .sort((a, b) => a.template.version.localeCompare(b.template.version, 'en', { numeric: true }));
  const last = found[found.length - 1];
  if (!last) throw new Error(`no template ${name}@${major}`);
  return last;
};

/** The compiled config of a corpus `projects/<name>.yaml` (overlay on the newest template of its major) or `templates/<key>/<version>.yaml`. */
export function goldenConfig(path: string): CompiledConfig {
  const doc = goldenYaml(path);
  let file: TemplateFile;
  if (path.startsWith('projects/')) {
    const overlay = OverlayFileSchema.parse(doc);
    const [name, major] = overlay.extends.split('@');
    const m = merge(newestTemplate(name as string, major as string), overlay);
    if (m.issues.length > 0) throw new Error(`overlay ${path} does not merge: ${JSON.stringify(m.issues)}`);
    file = TemplateFileSchema.parse(m.file);
  } else file = TemplateFileSchema.parse(doc);
  const r = compile(file, { assets: goldenAssets });
  if (!r.ok) throw new Error(`${path} does not compile: ${JSON.stringify(r.problems)}`);
  return r.config;
}

/** Feature aliases (`t_in`, `park`, `$new:m1`) to deterministic ids. */
export class Aliases {
  private readonly map = new Map<string, FeatureId>();
  private n = 0;

  id(alias: string): FeatureId {
    const known = this.map.get(alias);
    if (known) return known;
    const id = `00000000-0000-7000-8000-${(++this.n).toString(16).padStart(12, '0')}` as FeatureId;
    this.map.set(alias, id);
    return id;
  }
  has(alias: string): boolean {
    return this.map.has(alias);
  }
  bind(alias: string, id: FeatureId): void {
    this.map.set(alias, id);
  }
  /** The alias of an id, if it has one. */
  aliasOf(id: string): string | undefined {
    for (const [a, v] of this.map) if (v === id) return a;
    return undefined;
  }
}

export interface SeedFeatures {
  readonly [alias: string]: { readonly type: string; readonly properties?: { readonly [k: string]: Json } };
}

/**
 * Seeds are facts, not runs: they arrive as observations of one import run, bypassing tasks. String
 * values of `reference` properties that name an alias become that feature's id.
 */
export function seedFeatures(store: MemoryStore, features: SeedFeatures, aliases: Aliases): void {
  const types = store.config.file.types as unknown as Record<
    string,
    { properties?: Record<string, { type: string }> }
  >;
  for (const alias of Object.keys(features)) aliases.id(alias);
  for (const [alias, f] of Object.entries(features)) {
    const observations: Observation[] = [];
    const featureId = aliases.id(alias);
    observations.push({ featureId, property: '$type', result: f.type });
    for (const [property, value] of Object.entries(f.properties ?? {})) {
      const isRef = types[f.type]?.properties?.[property]?.type === 'reference';
      const result = isRef && typeof value === 'string' && aliases.has(value) ? aliases.id(value) : value;
      observations.push({ featureId, property, result });
    }
    store.append(SEED_RUN, observations);
  }
}
