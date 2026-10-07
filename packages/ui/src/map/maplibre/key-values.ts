import type { ClusterClient } from '../cluster/client';
import type { FeatureSource } from '../contract';
import { WORLD } from './renderer-util';
import type { YieldToMain } from './chunk';
import type { LayerDef } from './layers';
import { pointPropertyKeys } from './style';

/**
 * The style's property keys go to the cluster worker; the values of a new key are read from the source in slices with a
 * yield between each (WP-848), so a large view never costs one long task. A newer call (or `cancel`) ends the older walk and takes
 * over the keys still owed values. `refresh` runs when the keys changed and again when the values are all sent.
 */
export function createKeyValues(
  clusters: ClusterClient,
  source: FeatureSource,
  yieldNow: YieldToMain,
  refresh: () => void,
): ((layers: readonly LayerDef[]) => void) & { cancel(): void } {
  let walk = 0;
  const owed = new Set<string>();
  const apply = (layers: readonly LayerDef[]): void => {
    const keys = pointPropertyKeys(layers);
    const added = clusters.beginKeys(keys);
    if (added === undefined) return;
    for (const k of added) owed.add(k);
    for (const k of owed) if (!keys.includes(k)) owed.delete(k);
    refresh();
    const mine = ++walk;
    void (async () => {
      const slices = source.queryChunks(WORLD);
      for (let n = slices.next(); n.done !== true; n = slices.next()) {
        clusters.addValues([...owed], n.value);
        await yieldNow();
        if (mine !== walk) return;
      }
      owed.clear();
      refresh();
    })();
  };
  return Object.assign(apply, { cancel: () => void walk++ });
}
