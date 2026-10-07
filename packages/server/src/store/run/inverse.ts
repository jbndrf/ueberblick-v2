import type { CompiledConfig } from '@ueberblick/core';
import type { InverseRelations } from '../contract';

const cache = new WeakMap<object, InverseRelations>();

/**
 * Where the edges of every `inverse_of` relation are stored: `<type>.<relation>` to the stored key and the type
 * that stores them (`inverse_of: 'baum.flaeche'` on `flaeche.baeume` reads `flaeche` edges of `baum` backwards).
 * Same reading of the file as core's `sqlInverse`, plus the source type; see the store README (follow-up: core).
 */
export function inverseRelations(config: Pick<CompiledConfig, 'file'>): InverseRelations {
  const hit = cache.get(config.file);
  if (hit !== undefined) return hit;
  const out = new Map<string, { key: string; from: string }>();
  for (const [tk, type] of Object.entries(config.file.types ?? {}))
    for (const [rk, rel] of Object.entries(type.relations ?? {})) {
      const [from, key] = rel.inverse_of?.split('.') ?? [];
      if (from !== undefined && key !== undefined) out.set(`${tk}.${rk}`, { key, from });
    }
  cache.set(config.file, out);
  return out;
}
