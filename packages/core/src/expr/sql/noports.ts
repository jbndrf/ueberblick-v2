/** Stand-in ports for constant folding: no rows to read, and no geometry unless the caller gives one. */
import type { Geo } from '../../geo/contract';
import type { EvalContext } from '../contract';

/** A geometry port for folding when the caller gave none: every call fails, so the constant is unsupported. */
export const NO_GEO = new Proxy({} as Geo, {
  get: () => () => {
    throw new Error('no geometry port');
  },
});

export const NO_FEATURES: EvalContext['features'] = {
  property: () => undefined,
  related: () => [],
  history: () => [],
  type: () => undefined,
};
