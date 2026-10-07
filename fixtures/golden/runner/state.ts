/** Final-state assertions (`then.features`, `edges`, `edges_absent`, `ledger`). Each problem names the feature aliases it concerns. */
import { isServed } from '@ueberblick/core';
import { isRec, matches, withIds, type Rec } from './match';
import type { ScenarioWorld } from './world';

export interface StateProblem {
  /** Feature aliases the problem is about (empty for scenario-wide ones such as the ledger). */
  readonly aliases: readonly string[];
  readonly message: string;
}

/** Keys of one `then.features.<alias>` entry: asserted (`true`) or skipped with a reason. */
export const FEATURE_KEYS: Readonly<Record<string, true | string>> = {
  exists: true,
  type: true,
  properties: true,
  absent: true,
  has_geometry: true,
  derived: 'derived geometry values (bbox_3d, anchor) are asserted in the geo tests; the fake store keeps no Z bbox',
  in_spatial_index: 'the spatial index is an adapter concern (Phase 2)',
};

export const unclassifiedFeatureKeys = (want: unknown): string[] =>
  Object.values(isRec(want) ? want : {}).flatMap((e) => Object.keys(isRec(e) ? e : {})).filter((k) => !(k in FEATURE_KEYS));

/** Reasons for feature keys that are skipped, for the report. */
export const skippedFeatureKeys = (want: unknown): { key: string; reason: string }[] =>
  [...new Set(Object.values(isRec(want) ? want : {}).flatMap((e) => Object.keys(isRec(e) ? e : {})))].flatMap((k) => {
    const r = FEATURE_KEYS[k];
    return typeof r === 'string' ? [{ key: k, reason: r }] : [];
  });

export function checkState(w: ScenarioWorld, key: string, want: unknown): StateProblem[] {
  const out: StateProblem[] = [];
  const store = w.server;
  const geometryKeys = (type: string): string[] =>
    Object.entries((w.server.config.file.types as unknown as Record<string, { properties?: Record<string, { type: string }> }>)[type]?.properties ?? {})
      .filter(([, p]) => p.type === 'geometry')
      .map(([k]) => k);

  if (key === 'features') {
    for (const [alias, exp] of Object.entries(want as Record<string, Rec>)) {
      const bad = (message: string): void => void out.push({ aliases: [alias], message: `features.${alias}: ${message}` });
      const f = store.feature(w.aliases.id(alias));
      if (exp['exists'] === false) {
        if (f !== undefined && isServed(f.lifecycle)) bad('must not exist');
        continue;
      }
      if (f === undefined) {
        bad('does not exist');
        continue;
      }
      if (typeof exp['type'] === 'string' && f.type !== exp['type']) bad(`type ${f.type}, expected ${String(exp['type'])}`);
      for (const [p, v] of Object.entries((exp['properties'] ?? {}) as Rec)) {
        if (!matches(withIds(v, w.aliases), f.properties[p])) bad(`${p} is ${JSON.stringify(f.properties[p])}, expected ${JSON.stringify(v)}`);
      }
      for (const p of (exp['absent'] as string[] | undefined) ?? []) {
        if (f.properties[p] !== undefined && f.properties[p] !== null) bad(`${p} must be absent`);
      }
      if (typeof exp['has_geometry'] === 'boolean') {
        const has = geometryKeys(f.type).some((g) => f.properties[g] != null);
        if (has !== exp['has_geometry']) bad(`has_geometry is ${String(has)}, expected ${String(exp['has_geometry'])}`);
      }
    }
  } else if (key === 'edges' || key === 'edges_absent') {
    for (const e of want as Rec[]) {
      const from = String(e['from']);
      const to = String(e['to']);
      const found = store
        .edgesFrom(w.aliases.id(from))
        .some((x) => x.relation === e['relation'] && x.to === w.aliases.id(to) && (e['derived'] === undefined || x.derived === e['derived']));
      const aliases = [from, to];
      if (key === 'edges' && !found) out.push({ aliases, message: `edges: missing ${JSON.stringify(e)}` });
      if (key === 'edges_absent' && found) out.push({ aliases, message: `edges_absent: ${JSON.stringify(e)} exists` });
    }
  } else if (key === 'ledger') {
    const total = w.server.ledgerOkCount();
    const exp = (want as Rec)['runs_total'];
    if (exp !== undefined && total !== exp) out.push({ aliases: [], message: `ledger.runs_total: ${total}, expected ${String(exp)}` });
  }
  return out;
}
