// The real renderer over three points and one area of a type with a classifying property (WP-674). Test fixture only.
import 'maplibre-gl/dist/maplibre-gl.css';
import type { View } from '@ueberblick/core/model';
import { LOOK_KEY, lookKeyOfProperties, viewLooks } from '@ueberblick/core/marker';
import { createMaplibreRenderer } from '../renderer';
import { feature, pointFeature, testSource } from '../../test-helpers';

const type = {
  classify: {
    property: 'zustand',
    values: {
      gut: { color: '#16a34a', icon: { key: 'leaf' } },
      schlecht: { color: '#dc2626', icon: { key: 'triangle-alert', size: 40 } },
      mittel: { color: '#ca8a04' },
    },
  },
  marker: { color: '#336699' },
} as const;

// A second Objektart (WP-744): a magenta dot, classifying by a property of the same name as the first type's.
const baum = { classify: { property: 'zustand', values: { gut: { color: '#a21caf' } } } } as const;
const types = { mangel: type, baum } as never;
const withLook = (typeKey: 'mangel' | 'baum', props: { zustand: string }) => ({
  ...props,
  [LOOK_KEY]: lookKeyOfProperties(typeKey, types[typeKey] as never, props) ?? '',
});

const view = { camera: { center: [8, 50], zoom: 12 } } as unknown as View;
const area = feature(
  'fl1',
  {
    type: 'Polygon',
    coordinates: [
      [
        [8.02, 49.97],
        [8.04, 49.97],
        [8.04, 49.99],
        [8.02, 49.99],
        [8.02, 49.97],
      ],
    ],
  },
  [8.03, 49.98],
  withLook('mangel', { zustand: 'schlecht' }),
);
const source = testSource([
  pointFeature('p1', 7.97, 50.02, withLook('mangel', { zustand: 'gut' })),
  pointFeature('p2', 7.99, 50.02, withLook('mangel', { zustand: 'schlecht' })),
  pointFeature('p3', 8.01, 50.02, withLook('mangel', { zustand: 'mittel' })),
  // WP-688: a second area with a point and a line inside it. Their anchors sit far away so no cluster stands on the tap spots.
  pointFeature('p5', 7.975, 49.985, withLook('mangel', { zustand: 'gut' })),
  feature(
    'l1',
    {
      type: 'LineString',
      coordinates: [
        [7.965, 49.965],
        [7.965, 49.975],
      ],
    },
    [7.95, 49.9],
  ),
  feature(
    'fl2',
    {
      type: 'Polygon',
      coordinates: [
        [
          [7.96, 49.955],
          [8, 49.955],
          [8, 49.995],
          [7.96, 49.995],
          [7.96, 49.955],
        ],
      ],
    },
    [8.08, 49.9],
  ),
  pointFeature('p6', 8, 50.04, withLook('baum', { zustand: 'gut' })), // WP-744: another Objektart, same property name
  pointFeature('p4', 8.03, 50.02, withLook('mangel', { zustand: 'unbekannt' })),
  area,
]);

const handle = createMaplibreRenderer().mount(document.getElementById('map') as HTMLElement, view, source);
handle.setLooks?.(viewLooks(types, ['mangel', 'baum']));
const w = window as unknown as { __handle: typeof handle; __ready: boolean; __taps: string[] };
w.__handle = handle;
// A new deploy changed the look of the second type: the same call the app makes when its config is replaced.
(w as unknown as { __relook: () => void }).__relook = () =>
  handle.setLooks?.(
    viewLooks(
      {
        mangel: type,
        baum: { classify: { property: 'zustand', values: { gut: { color: '#dc2626' } } } },
      } as never,
      ['mangel', 'baum'],
    ),
  );
w.__taps = [];
handle.onFeatureTap((id) => w.__taps.push(id));
handle.onMapTap(() => w.__taps.push('map'));
void handle.ready.then(() => {
  w.__ready = true;
});
