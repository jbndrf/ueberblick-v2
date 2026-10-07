// The one static import of the MapLibre Style Spec in ui. `view-style.ts` reaches it only through a
// dynamic import, so the builder loads it when a check runs (map.spec keeps "maplibre-gl" names in maplibre/).
import { expression, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

export { validateStyleMin };

// The spec exposes the filter check through its `expression` namespace, not at the top level.
export const isExpressionFilter = expression.isExpressionFilter;
