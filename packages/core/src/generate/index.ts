/**
 * Generated features for the simulator and the preview's demo data (WP-342): one plausible value per property, chosen by the property's
 * type. The table is keyed by the property-type registry, so a new property type is a compile error
 * here until it gets a generator (R6).
 */
import type { Json, Key } from '../model';
import { processesOf } from '../process';
import type { PropertyTypeKey } from '../registry';
import type { FeatureType } from '../schema';
import type { Property } from '../schema/property';

export interface GenerateContext {
  /** 0, 1, 2, …: makes successive features differ (positions, texts). */
  readonly n: number;
  /** An existing feature of a type, for `reference`; undefined when the sandbox has none. */
  readonly featureOf: (type: Key) => string | undefined;
  /** The participant id used for `participant` properties. */
  readonly participant: string;
  /** Where geometry is generated around: `[lon, lat]`. */
  readonly center: readonly [number, number];
  /** A seeded random source in [0, 1) (`seededRng`); core never reads `Math.random` (R2). */
  readonly rng: () => number;
}

/** mulberry32: a small seeded generator, the same numbers for the same seed on every device. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Features of one type spread around a centre stay within this many degrees of it (about 1 km at 50 N). */
const SPREAD = 0.001;
const RING = 5;

type Generator = (p: Property, key: string, c: GenerateContext) => Json | undefined;

const firstOption = (p: Property): string | undefined => Object.keys(p.options ?? {})[0];

function geometry(p: Property, c: GenerateContext): Json {
  const x = c.center[0] + (c.n % RING) * 0.001 + (c.rng() - 0.5) * 2 * SPREAD;
  const y = c.center[1] + (c.n % RING) * 0.001 + (c.rng() - 0.5) * 2 * SPREAD;
  const kind = p.geometry_type as string | undefined;
  if (kind?.toLowerCase().includes('polygon') === true)
    return {
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + 0.002, y],
          [x + 0.002, y + 0.002],
          [x, y + 0.002],
          [x, y],
        ],
      ],
    };
  if (kind?.toLowerCase().includes('line') === true)
    return {
      type: 'LineString',
      coordinates: [
        [x, y],
        [x + 0.002, y + 0.002],
      ],
    };
  return { type: 'Point', coordinates: [x, y] };
}

const GENERATORS: { readonly [K in PropertyTypeKey]: Generator } = {
  text: (_p, key, c) => `${key} ${c.n + 1}`,
  localized_text: (_p, key, c) => ({ en: `${key} ${c.n + 1}` }),
  number: (p) => Math.max(p.min ?? 0, Math.min(p.max ?? Infinity, 1)),
  integer: (p) => Math.max(p.min ?? 0, Math.min(p.max ?? Infinity, 1)),
  boolean: () => false,
  time: () => '08:00',
  date: () => '2026-05-01',
  datetime: () => '2026-05-01T08:00:00.000Z',
  select: (p) => firstOption(p),
  multiselect: (p) => {
    const first = firstOption(p);
    return first === undefined ? [] : [first];
  },
  geometry: (p, _k, c) => geometry(p, c),
  participant: (_p, _k, c) => c.participant,
  role: () => undefined,
  reference: (p, _k, c) => (p.to === undefined ? undefined : c.featureOf(p.to as Key)),
  file: () => undefined,
};

/** Values for every property of a type: its `default` when it has one, else a generated one. */
export function generateProperties(
  properties: { readonly [key: string]: Property },
  c: GenerateContext,
): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const [key, p] of Object.entries(properties)) {
    const value = p.default !== undefined ? p.default : GENERATORS[p.type](p, key, c);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The stage of the n-th generated feature of a type: the first feature at the process start, then one per further
 * stage in declaration order, wrapping. `undefined` for a type without a process.
 */
export function spreadStage(type: FeatureType, n: number): { property: Key; stage: Key } | undefined {
  const [proc] = processesOf(type);
  if (proc === undefined) return undefined;
  const rest = proc.options.filter((o) => o !== proc.start);
  const stage = n === 0 || rest.length === 0 ? proc.start : (rest[(n - 1) % rest.length] as Key);
  return { property: proc.property, stage };
}
