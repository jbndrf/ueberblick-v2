// Where a map click goes (WP-688, WP-698): one hit test (`pickHit`), then a cluster drills in, a feature is tapped, and
// empty map reports its position. A tool that owns the tap (the pin, the drawing) captures it: v3 skipped the map's own
// selection while `isEditingLocation` (`+page.svelte:2388`) and let a tap on a polygon reach the tool (`wasFeatureTap`
// marked only marker taps, `WorkflowSelector.svelte:233`), so a tree inside an area could be moved.
import type { Position } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import type { MlMap, MlMapClick } from './api';
import { pickHit, tapBox, type HitClass, type RenderedHit } from './tap';

export interface TapRouting {
  onClick(e: MlMapClick): void;
  /** While on, every tap is an empty-map tap with its position, whatever is under it. */
  capture(on: boolean): void;
}

export interface TapRoutingDeps {
  map(): MlMap | undefined;
  /** The layers a tap can hit, with their class. */
  readonly tappable: ReadonlyMap<string, HitClass>;
  feature(id: FeatureId): void;
  cluster(clusterId: number, at: Position): void;
  empty(at: Position): void;
}

export function createTapRouting(deps: TapRoutingDeps): TapRouting {
  let captured = false;
  const select = (hit: RenderedHit): void => {
    const props = hit.properties ?? {};
    if (typeof props.clusterId === 'number') {
      const coordinates = hit.geometry?.coordinates;
      if (!Array.isArray(coordinates)) return;
      deps.cluster(props.clusterId, [Number(coordinates[0]), Number(coordinates[1])]);
      return;
    }
    const id = typeof props.featureId === 'string' ? props.featureId : props.id;
    if (typeof id === 'string') deps.feature(id as FeatureId);
  };
  return {
    capture: (on) => {
      captured = on;
    },
    onClick(e) {
      const map = deps.map();
      if (map === undefined) return;
      const hit =
        captured || deps.tappable.size === 0
          ? undefined
          : pickHit(
              map.queryRenderedFeatures(tapBox(e.point), { layers: [...deps.tappable.keys()] }),
              deps.tappable,
            );
      if (hit !== undefined) select(hit);
      else deps.empty([e.lngLat.lng, e.lngLat.lat]);
    },
  };
}
