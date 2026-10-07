// DOM markers (v3's draggable placement pin, WP-632). They live outside every GeoJSON source: a drag moves one
// element and calls the listeners, so no feature is re-sent and no cluster is recomputed (R14).
import type { Position } from '@ueberblick/core/geo';
import type { MarkerOptions } from '../contract';
import type { MaplibreApi, MlMap, MlMarker } from './api';

export interface MarkerLayer {
  add(id: string, at: Position, options: MarkerOptions): void;
  move(id: string, at: Position): void;
  position(id: string): Position | undefined;
  remove(id: string): void;
  /** Draws what was added before the map loaded. */
  attach(api: MaplibreApi, map: MlMap): void;
  dispose(): void;
}

interface Entry {
  at: Position;
  readonly options: MarkerOptions;
  marker?: MlMarker;
}

/** `onDrag` hears every move of a drag and its end. */
export function createMarkerLayer(onDrag: (id: string, at: Position) => void): MarkerLayer {
  const entries = new Map<string, Entry>();
  let host: { api: MaplibreApi; map: MlMap } | undefined;

  const draw = (id: string, entry: Entry): void => {
    if (host === undefined) return;
    const marker = new host.api.Marker({
      element: entry.options.element,
      draggable: entry.options.draggable === true,
      anchor: 'center',
    }).setLngLat([entry.at[0], entry.at[1]]);
    const report = (): void => {
      const { lng, lat } = marker.getLngLat();
      entry.at = [lng, lat];
      onDrag(id, entry.at);
    };
    // MapLibre's `on` returns a subscription, not the marker: no chaining
    marker.on('drag', report);
    marker.on('dragend', report);
    marker.addTo(host.map);
    entry.marker = marker;
  };

  return {
    add(id, at, options) {
      entries.get(id)?.marker?.remove();
      const entry: Entry = { at, options };
      entries.set(id, entry);
      draw(id, entry);
    },
    move(id, at) {
      const entry = entries.get(id);
      if (entry === undefined) return;
      entry.at = at;
      entry.marker?.setLngLat([at[0], at[1]]);
    },
    position: (id) => entries.get(id)?.at,
    remove(id) {
      entries.get(id)?.marker?.remove();
      entries.delete(id);
    },
    attach(api, map) {
      host = { api, map };
      for (const [id, entry] of entries) draw(id, entry);
    },
    dispose() {
      for (const entry of entries.values()) entry.marker?.remove();
      entries.clear();
      host = undefined;
    },
  };
}
