// The marker looks of one renderer (WP-674): the plan of the type's look by value and the images on the map.
import type { MarkerLooks } from '@ueberblick/core/marker';
import type { MlMap } from './api';
import { planLooks, type LookPlan } from './looks';
import type { Rasterize } from './raster';

export function createLooks(deps: { readonly rasterize: Rasterize; readonly destroyed: () => boolean }) {
  let plan: LookPlan | undefined;
  const registered = new Set<string>(); // image ids on the map
  return {
    plan: (): LookPlan | undefined => plan,
    set(next: MarkerLooks | undefined): void {
      plan = next === undefined ? undefined : planLooks(next);
    },
    /** Registers the images of the plan that are not on the map yet; one drawing is rasterised once (v3 interned it). */
    async addImages(m: MlMap): Promise<void> {
      for (const image of plan?.images ?? []) {
        if (registered.has(image.id)) continue;
        registered.add(image.id);
        const raster = await deps.rasterize(image.svg, image.px);
        if (!deps.destroyed() && !m.hasImage(image.id)) m.addImage(image.id, raster, { pixelRatio: 2 });
      }
    },
  };
}
