/** The generator spec of the golden corpus (fixtures/golden/bench-spec.yaml), loaded and typed. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export const GOLDEN_DIR = resolve(import.meta.dirname, '../../fixtures/golden');

export interface BenchSpec {
  readonly seed: number;
  readonly template: string;
  readonly total_features: number;
  readonly region: { readonly bbox: readonly [number, number, number, number] };
  readonly types: {
    readonly baum: { readonly count: number; readonly clusters: number; readonly cluster_sigma_m: number };
    readonly flaeche: {
      readonly count: number;
      readonly vertices: readonly [number, number];
      readonly holes_share: number;
    };
    readonly massnahme: { readonly count: number };
    readonly baumart: { readonly count: number };
  };
  readonly history: {
    readonly observations_per_property: { readonly min: number; readonly max: number };
    readonly kontrollen_share: number;
  };
  readonly assignment: { readonly participants: number; readonly assigned_share: number };
  readonly derived_edges: { readonly relation: string; readonly expected_share: number };
}

export function loadSpec(): BenchSpec {
  return parse(readFileSync(resolve(GOLDEN_DIR, 'bench-spec.yaml'), 'utf8')) as BenchSpec;
}

/** Type counts for `features` in total, in the spec's proportions; the remainder goes to `baum`. */
export function scaleCounts(spec: BenchSpec, features: number) {
  const share = (n: number) => Math.max(1, Math.round((features * n) / spec.total_features));
  const flaeche = share(spec.types.flaeche.count);
  const massnahme = share(spec.types.massnahme.count);
  const baumart = share(spec.types.baumart.count);
  return { baum: features - flaeche - massnahme - baumart, flaeche, massnahme, baumart };
}
