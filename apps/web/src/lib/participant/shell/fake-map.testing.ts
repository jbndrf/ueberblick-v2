import { compile } from '@ueberblick/core/compile';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { goldenAssets, type goldenConfig } from '@ueberblick/core/testing';
import type { ActivitySource } from '../reader';
import type { MapHandle } from '@ueberblick/ui';

const RING = 'data-fake-marker';

/** A map handle that records marker positions; marker elements (candidate rings) are attached to the body until removed. */
export function fakeMap(): MapHandle {
  const markers = new Map<string, [number, number]>();
  const elements = new Map<string, HTMLElement>();
  return {
    extent: () => [7, 50, 7.2, 50.2],
    onExtentChange: () => () => {},
    onMove: () => () => {},
    onMapTap: () => () => {},
    onMarkerDrag: () => () => {},
    addMarker: (id: string, p: [number, number], o?: { element?: HTMLElement }) => {
      markers.set(id, p);
      if (o?.element) {
        o.element.setAttribute(RING, '');
        elements.set(id, o.element);
        document.body.appendChild(o.element);
      }
    },
    moveMarker: (id: string, p: [number, number]) => markers.set(id, p),
    markerPosition: (id: string) => markers.get(id),
    removeMarker: (id: string) => {
      markers.delete(id);
      elements.get(id)?.remove();
      elements.delete(id);
    },
    showOverlay: () => {},
    clearOverlay: () => {},
    unproject: () => [7.1, 50.1],
  } as unknown as MapHandle;
}

/** Drops marker elements a test left behind. */
export function removeFakeMarkers(): void {
  document.querySelectorAll(`[${RING}]`).forEach((e) => e.remove());
}

export const PARENT = {
  id: 'f-parent' as FeatureId,
  type: 'flaeche' as Key,
  lifecycle: 'active',
  properties: { name: 'Park', geometrie: { type: 'Point', coordinates: [7.15, 50.15] } },
} as never as FeatureState;

/** Baum gets an optional reference to its Fläche, which lists the Bäume as its children (the hierarchy, WP-647); recompiled. */
export function withParentRelation(c: ReturnType<typeof goldenConfig>): ReturnType<typeof goldenConfig> {
  const types = c.file.types ?? {};
  const [baum, flaeche, erfassen] = [types['baum'], types['flaeche'], c.file.tasks?.['erfassen']];
  if (!baum || !flaeche || !erfassen) throw new Error('golden changed');
  const file = {
    ...c.file,
    types: {
      ...types,
      baum: {
        ...baum,
        properties: { ...baum.properties, flaeche_ref: { type: 'reference', to: 'flaeche' } },
      },
      flaeche: { ...flaeche, relations: { baeume: { to: 'baum', inverse_of: 'baum.flaeche_ref' } } },
    },
    tasks: { ...c.file.tasks, erfassen: { ...erfassen, form: { ...erfassen.form, flaeche_ref: {} } } },
  };
  const r = compile(file as never, { assets: goldenAssets });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

export const noActivity: ActivitySource = {
  activityWarm: () => false,
  warmActivity: () => Promise.resolve(),
  observationsOf: () => [],
  runMeta: () => undefined,
  personName: () => undefined,
  queuedRunsOf: () => [],
  plannedChangesOf: () => [],
};
