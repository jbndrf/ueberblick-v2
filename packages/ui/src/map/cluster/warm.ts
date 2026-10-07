import { ClusterIndex } from './index-core';
import type { ClusterPoint } from './protocol';

/** Points of the synthetic set: enough to get the build loops compiled, few enough to cost about 75 ms. */
export const WARM_POINTS = 4000;

/** A fixed pseudo-random set around (0, 0), spread so that clusters form at low zoom and not at high zoom. */
function syntheticPoints(): ClusterPoint[] {
  const points: ClusterPoint[] = [];
  let seed = 1;
  const next = (): number => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < WARM_POINTS; i++) points.push({ id: `w${i}`, lng: next() * 2, lat: next() * 2 });
  return points;
}

/**
 * Builds and queries a small synthetic index once, so the engine has compiled the hot loops of the build
 * (tree sort, radius search, cluster pass) when the real points arrive. The worker calls it at start, while it
 * waits for the first delivery (WP-584); its result is thrown away and it shares no state with a real index.
 */
export function warmUp(): void {
  const index = new ClusterIndex();
  index.apply(syntheticPoints(), [], []);
  index.query([0, 0, 2, 2], 6);
}
