/** core.fold: the only definition of current state (F4). Entry: `createFold(geo)`; the contract is `contract.ts`. */
import type { Geo } from '../geo';
import type { EdgeChanges, Fold } from './contract';
import { recomputeDerived } from './derived';
import { referenceEdges } from './edges';
import { foldFeature } from './state';

export type * from './contract';
export { edgeKey } from './edge-key';
export { RESERVED_VERSION } from './state';
export { RESERVED_CREATED_BY, auditOf, clampClientTime, creatorOf, foldAudit, resultTimeOf } from './audit';

export function createFold(geo: Geo): Fold {
  return {
    feature: (prev, observations, schema) => {
      const state = foldFeature(geo, prev, observations, schema);
      const edges: EdgeChanges = state.feature
        ? referenceEdges(prev, state.feature, state.changedProperties, schema)
        : { put: [], remove: [] };
      const inputs = state.feature ? (schema.types.get(state.feature.type)?.derivedInputs ?? []) : [];
      const derivedInputsChanged = inputs.filter(
        (p) => state.changedProperties.includes(p) && !state.geometryChanged.includes(p),
      );
      return { feature: state.feature, edges, geometryChanged: state.geometryChanged, derivedInputsChanged };
    },
    recomputeDerived: (feature, lookup, schema) => recomputeDerived(geo, feature, lookup, schema),
  };
}
