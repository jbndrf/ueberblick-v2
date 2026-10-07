/**
 * Standort: centre the map on the participant's GPS position and mark it (`+page.svelte:2444-2457`,
 * `user-location.ts`). v3 failed silently; here the caller learns that it failed and says so (register p2-map row 28).
 */
import type { MapHandle, PositionPort } from '@ueberblick/ui';
import { POSITION_ZOOM } from '@ueberblick/ui';

const DOT = 'standort';
/** v3's `user-location.ts`: Google blue, a dot of radius 8 (the overlay's point is `width + 3` px) with a white ring. */
const STANDORT_STYLE = { color: '#4285F4', width: 5 } as const;

/** True when the map now shows the position; false when the device could not tell (denied, no signal, timeout). */
export async function showStandort(
  map: Pick<MapHandle, 'centerOn' | 'showOverlay'>,
  position: PositionPort,
): Promise<boolean> {
  try {
    const fix = await position.current();
    map.centerOn([fix.lon, fix.lat], { zoom: POSITION_ZOOM });
    map.showOverlay(
      DOT,
      { type: 'Point', coordinates: [fix.lon, fix.lat] },
      fix.accuracy === undefined ? STANDORT_STYLE : { ...STANDORT_STYLE, accuracy: fix.accuracy },
    );
    return true;
  } catch {
    return false;
  }
}
