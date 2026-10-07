/**
 * `FeatureAccess` over the `Facts` port: how evaluate reads features (docs/06). The one
 * implementation for the planner (and, over its own facts, any side that evaluates expressions, R1).
 * A reference property is read as a relation, so `self.flaeche` is a feature, not an id string.
 */
import type { FeatureAccess } from '../expr/contract';
import type { FeatureId, Json, Key } from '../model';
import type { Facts } from '../ports';
import { SYSTEM_FIELD_SIGIL, readSystemField } from '../registry/system-fields';
import type { CompiledConfig } from '../schema/compile/contract';
import { sqlInverse } from '../schema/compile/views';

export function featureAccess(facts: Facts, config: CompiledConfig): FeatureAccess {
  const isReference = (type: Key, key: string): boolean =>
    config.foldTypes.get(type)?.references.some((r) => r.property === key) === true;

  return {
    property(id: FeatureId, key: string): Json | undefined {
      const f = facts.feature(id);
      if (f === undefined) return undefined;
      if (key.startsWith(SYSTEM_FIELD_SIGIL)) return readSystemField(f, key);
      if (isReference(f.type, key)) return undefined;
      const own = f.properties[key];
      if (own !== undefined || key !== 'geometry') return own;
      const primary = config.file.types?.[f.type]?.geometry;
      return primary === undefined ? undefined : f.properties[primary];
    },
    related(id: FeatureId, relation: Key): readonly FeatureId[] {
      const f = facts.feature(id);
      if (f === undefined) return [];
      const stored = sqlInverse(config).get(`${f.type}.${relation}`);
      if (stored !== undefined) {
        const fromType = config.file.types?.[f.type]?.relations?.[relation]?.inverse_of?.split('.')[0];
        return facts
          .edgesTo(id, stored as Key)
          .filter((e) => facts.feature(e.from)?.type === fromType)
          .map((e) => e.from);
      }
      return facts.edgesFrom(id, relation).map((e) => e.to);
    },
    history: (id, property, limit) => facts.history(id, property, limit),
    type: (id) => facts.feature(id)?.type,
  };
}
