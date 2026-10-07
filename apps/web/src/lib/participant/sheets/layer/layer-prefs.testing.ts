// A choice store that keeps the selection in memory, for specs of the controller, the sheet and the map.
import type { MapSelection } from '@ueberblick/core/registry';
import type { LayerChoiceStore } from './layer-prefs';

export function memoryChoice(
  initial?: MapSelection,
): LayerChoiceStore & { set(selection: MapSelection): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    write: (s) => void (value = s),
    set(s) {
      value = s;
      for (const l of [...listeners]) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
