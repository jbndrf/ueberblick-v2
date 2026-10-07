/**
 * Demo data for a preview (WP-342, A-031 item 3): about `perType` generated features per type, one `$seed` system run
 * each (R3), spread over the process stages and centred on the project's map. The generator is core's
 * (`generateProperties`), so a later template `demo:` section replaces this one function per type without touching the
 * refresher. Only the preview refresher calls it, and only with a preview's database: nothing here reaches a real project.
 */
import {
  SEED_TASK,
  generateProperties,
  seededRng,
  spreadStage,
  type Clock,
  type CompiledConfig,
  type FeatureId,
  type Json,
  type Key,
  type Run,
} from '@ueberblick/core';
import { composeProjectStore, createServerIds } from '../http/shared';
import type { Db } from '../db/driver';
import { deployedVersion } from '../deploy';
import type { Logger } from '../log';
import { SYSTEM_ACTOR } from '../timers/fire';

/** The map centre when the config declares none: the generator's historic default. */
export const DEFAULT_CENTER: readonly [number, number] = [7.1, 50.73];

export interface SeedOptions {
  readonly clock: Clock;
  readonly log: Logger;
  /** The preview participant every generated `participant` value points to (one of the preview logins, WP-373). */
  readonly participant: string;
  /** Features per type; default 5. */
  readonly perType?: number;
  /** `[lon, lat]`; default `previewCenter(config)`. */
  readonly center?: readonly [number, number];
  /** Seeds the random source: a reset passes a new one, so the geometry differs. */
  readonly seed?: number;
}

export interface SeedResult {
  readonly seeded: number;
  /** Runs the plan refused (a property whose generated value does not fit); the others are in. */
  readonly refused: number;
}

/** The project's home view: `map.start.center`, else the default. */
export function previewCenter(config: CompiledConfig): readonly [number, number] {
  const c = config.file.map?.start?.center;
  return c !== undefined && c.length >= 2 ? [c[0] as number, c[1] as number] : DEFAULT_CENTER;
}

/** Type keys with the types a reference points to first, so a reference finds a generated feature. */
function typeOrder(config: CompiledConfig): readonly Key[] {
  const types = config.file.types ?? {};
  const out: Key[] = [];
  const visit = (key: Key, path: ReadonlySet<string>): void => {
    if (out.includes(key) || path.has(key)) return;
    for (const p of Object.values(types[key]?.properties ?? {}))
      if (p.type === 'reference' && p.to !== undefined && types[p.to as Key] !== undefined)
        visit(p.to as Key, new Set([...path, key]));
    out.push(key);
  };
  for (const key of Object.keys(types)) visit(key as Key, new Set());
  return out;
}

export function seedPreview(db: Db, config: CompiledConfig, opts: SeedOptions): SeedResult {
  const version = deployedVersion(db)?.version;
  if (version === undefined) throw new Error('the preview has no deployed version to seed');
  const ids = createServerIds(opts.clock);
  const store = composeProjectStore(db, {
    clock: opts.clock,
    log: opts.log,
    ids,
    onOrphanedBlobs: () => undefined,
  });
  const center = opts.center ?? previewCenter(config);
  const perType = opts.perType ?? 5;
  const rng = seededRng(opts.seed ?? 1);
  const made = new Map<Key, FeatureId[]>();
  let seeded = 0;
  let refused = 0;
  for (const type of typeOrder(config)) {
    const declared = config.file.types?.[type];
    if (declared === undefined) continue;
    for (let n = 0; n < perType; n++) {
      const values: { [k: string]: Json } = generateProperties(declared.properties, {
        n,
        center,
        rng,
        participant: opts.participant,
        featureOf: (t) => {
          const list = made.get(t);
          return list === undefined ? undefined : list[n % list.length];
        },
      });
      const stage = spreadStage(declared, n);
      if (stage !== undefined) values[stage.property] = stage.stage;
      const run: Run = {
        id: ids.runId(),
        task: SEED_TASK as Key,
        actor: SYSTEM_ACTOR,
        configVersion: version,
        featureId: ids.featureId(),
        input: { type, values },
      };
      const r = store.submit(run);
      if (r.outcome === 'accepted') {
        seeded++;
        made.set(type, [...(made.get(type) ?? []), run.featureId as FeatureId]);
      } else refused++;
    }
  }
  return { seeded, refused };
}
