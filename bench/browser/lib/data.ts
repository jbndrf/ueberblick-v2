// Seeded fixtures for the browser scenarios. Generated at page load, never committed.
import type { Property } from '@ueberblick/core';
import type { MapFeature } from '../../../packages/ui/src/map/contract';
import { pointFeature } from '../../../packages/ui/src/map/test-helpers';

/** Rough box around Germany, like the golden 60k dataset. */
export const FIXTURE_BBOX = [5.9, 47.3, 15.0, 55.0] as const;

/** Nothing is generated within FREE_RADIUS degrees of this point (more than a cluster radius at zoom 5), so a feature moved here is a single marker. */
export const FREE_RADIUS = 3;
export const FREE_SPOT = [7.0, 53.0] as const;

/** mulberry32: small, fast, good enough for fixtures. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` point features, clustered around towns so density looks like a cadastre (seeded). */
export function generateFeatures(n: number, seed: number): MapFeature[] {
  const next = rng(seed);
  const [w, s, e, north] = FIXTURE_BBOX;
  const towns: (readonly [number, number])[] = [];
  while (towns.length < 200) {
    const t = [w + next() * (e - w), s + next() * (north - s)] as const;
    if (Math.hypot(t[0] - FREE_SPOT[0], t[1] - FREE_SPOT[1]) > FREE_RADIUS) towns.push(t);
  }
  const out: MapFeature[] = [];
  for (let i = 0; i < n; i++) {
    const [cx, cy] = towns[Math.floor(next() * towns.length)] ?? [w, s];
    const lng = Math.min(e, Math.max(w, cx + (next() - 0.5) * 0.2));
    const lat = Math.min(north, Math.max(s, cy + (next() - 0.5) * 0.14));
    out.push(pointFeature(`f${i}`, lng, lat, { species: `s${i % 40}` }));
  }
  return out;
}

type Form = Readonly<Record<string, { readonly relevant?: string; readonly constraint?: string }>>;

export interface FormFixture {
  readonly form: Form;
  readonly properties: Record<string, Property>;
}

const KINDS = ['text', 'number', 'boolean', 'date', 'select'] as const;

/** A task form with `n` fields of mixed types; every third field has a `relevant`, every fourth a `constraint`. */
export function formFixture(n: number): FormFixture {
  const properties: Record<string, Property> = {};
  const form: Record<string, { relevant?: string; constraint?: string }> = {};
  for (let i = 0; i < n; i++) {
    const kind = KINDS[i % KINDS.length] ?? 'text';
    const extra = kind === 'select' ? { options: { a: 'Alpha', b: 'Beta', c: 'Gamma' } } : {};
    properties[`f${i}`] = { type: kind, label: `Field ${i}`, ...extra } as unknown as Property;
    const entry: { relevant?: string; constraint?: string } = {};
    if (i % 3 === 0) entry.relevant = 'true';
    if (i % 4 === 0) entry.constraint = 'true';
    form[`f${i}`] = entry;
  }
  return { form, properties };
}
