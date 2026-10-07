// WP-859: 60k Baumkataster trees on the real device index (MemoryIndex) with the real view source and Liste reader,
// so the browser bench measures the participant's Liste and filter change, not a stand-in. Same fixture as
// bench/relation-hop-filter (one Fläche per tree, a view filter with one relation hop).
import { parse } from 'yaml';
import { createGeo, type Bbox } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Actor, Edge, FeatureId, Instant, Key } from '@ueberblick/core/model';
import { compile, NO_ASSETS } from '../../../packages/core/src/schema/compile';
import { TemplateFileSchema } from '../../../packages/core/src/schema/file';
import { MemoryIndex } from '../../../packages/client/src/store/memory';
import { createViewList, createViewSource } from '../../../apps/web/src/lib/participant/view-source';
import template from '../../../fixtures/golden/templates/baumkataster/1.0.0.yaml?raw';

export const HOP = "self.flaeche.name == 'Nord' && self.vitalitaet != 'v0'";
/** A filter on one property: most trees pass, so the Liste has about 48k rows (the heavy case). */
export const PLAIN = "self.vitalitaet != 'v0'";
const AREAS = 100;
const actor: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;

export const EVERYWHERE: Bbox = [-180, -90, 180, 90];

export function configWith(filter: string): CompiledConfig {
  const raw = parse(template) as { views: { alle_baeume: { source: { filter?: string } } } };
  raw.views.alle_baeume.source.filter = filter;
  const r = compile(TemplateFileSchema.parse(raw), { assets: NO_ASSETS });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

export function world(trees: number): MemoryIndex {
  const mem = new MemoryIndex();
  const square: [number, number][] = [[7, 50], [8, 50], [8, 51], [7, 50]];
  for (let s = 0; s < AREAS; s++)
    mem.putFeature({
      id: id(s),
      type: 'flaeche' as Key,
      properties: {
        geometrie: { type: 'Polygon', coordinates: [square] },
        name: s % 10 === 3 ? 'Nord' : `Fläche ${s}`,
      } as never,
      lifecycle: 'active',
      updatedSeq: s + 1,
    });
  for (let i = 0; i < trees; i++) {
    const n = AREAS + i;
    mem.putFeature({
      id: id(n),
      type: 'baum' as Key,
      properties: {
        geometrie: { type: 'Point', coordinates: [7 + (i % 300) / 100, 50 + Math.floor(i / 300) / 200] },
        stage: 'erfasst',
        vitalitaet: i % 5 === 0 ? 'v0' : 'v2',
        art: id(i % AREAS),
        hoehe_m: i % 30,
      } as never,
      lifecycle: 'active',
      updatedSeq: n + 1,
    });
    const e: Edge = { from: id(n), relation: 'flaeche' as Key, to: id(i % AREAS), derived: false };
    mem.putEdge(e, n + 1);
  }
  return mem;
}

export function viewDeps(mem: MemoryIndex, config: CompiledConfig) {
  return {
    facts: {
      feature: (f: FeatureId) => mem.feature(f),
      near: (t: Key, b: Bbox) => mem.near(t, b),
      ofType: (t: Key) => mem.ofType(t),
      edgesFrom: (f: FeatureId, r?: Key) => mem.edgesFrom(f, r),
      edgesTo: (f: FeatureId, r?: Key) => mem.edgesTo(f, r),
      history: () => [],
    },
    config,
    actor,
    geo: createGeo(),
    now: () => '2026-09-30T10:00:00.000Z' as Instant,
    viewKey: 'alle_baeume',
  };
}

export const listOf = (mem: MemoryIndex, config: CompiledConfig) =>
  createViewList({ ...viewDeps(mem, config), locales: ['de'] });

export const sourceOf = (mem: MemoryIndex, config: CompiledConfig) =>
  createViewSource({ ...viewDeps(mem, config), changed: { subscribe: () => () => undefined } });
