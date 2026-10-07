import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { MAP_VIEW_DEFAULTS } from '../../../../../../lib/admin/settings/map-view';
import {
  brandingView as brandingOf,
  mapView as mapOf,
  setBranding,
  setMapView,
  type SettingsEdit,
} from './settings-doc';

const brandingView = (doc: Doc, locale: string) => brandingOf(doc.effective(), locale);
const mapView = (doc: Doc) => mapOf(doc.effective());

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
const open = (): Doc =>
  openProject(golden('templates/baumkataster/1.1.0.yaml'), golden('projects/musterstadt-baeume.yaml'));
const must = (r: SettingsEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const SHA = 'ab'.repeat(32);

describe('branding goes into the draft overlay (A-036, E-5)', () => {
  it('starts empty: no name, no icon', () => {
    expect(brandingView(open(), 'de')).toEqual({ name: '', icon: null });
  });
  it('sets the Anzeigename and the icon sha, keeps one when the other changes, and the doc is dirty', () => {
    let doc = must(setBranding(open(), { name: ' Musterstadt App ' }, 'de'));
    expect(doc.dirty).toBe(true);
    expect(brandingView(doc, 'de')).toEqual({ name: 'Musterstadt App', icon: null });
    doc = must(setBranding(doc, { icon: SHA }, 'de'));
    expect(brandingView(doc, 'de')).toEqual({ name: 'Musterstadt App', icon: SHA });
    expect(doc.effective().branding).toEqual({ name: 'Musterstadt App', icon: SHA });
  });
  it('removes the icon and clears the name', () => {
    let doc = must(setBranding(open(), { name: 'X', icon: SHA }, 'de'));
    doc = must(setBranding(doc, { icon: null }, 'de'));
    expect(brandingView(doc, 'de')).toEqual({ name: 'X', icon: null });
    doc = must(setBranding(doc, { name: '  ' }, 'de'));
    expect(brandingView(doc, 'de')).toEqual({ name: '', icon: null });
  });
  it('writes the name for the page language when the name is already per language', () => {
    const first = open().apply({ kind: 'set', path: 'branding.name', value: { de: 'Stadt', en: 'City' } });
    expect(first.refused).toBeUndefined();
    const doc = must(setBranding(first.doc, { name: 'Stadt neu' }, 'de'));
    expect(doc.effective().branding?.name).toEqual({ de: 'Stadt neu', en: 'City' });
    expect(brandingView(doc, 'en').name).toBe('City');
  });
});

describe('Standardansicht goes into map.start, map.min_zoom and map.max_zoom', () => {
  it('shows v3 defaults, unsaved, while the file sets nothing', () => {
    const v = mapView(open());
    if (v.saved) expect(v.zoom).toBeGreaterThanOrEqual(0);
    else expect(v).toEqual({ ...MAP_VIEW_DEFAULTS, saved: false });
  });
  it('saves centre (lon, lat), zoom and bounds, and reads them back', () => {
    const doc = must(setMapView(open(), { lat: 50.7, lng: 7.1, zoom: 12, minZoom: 4, maxZoom: 17 }));
    expect(doc.effective().map).toMatchObject({
      start: { center: [7.1, 50.7], zoom: 12 },
      min_zoom: 4,
      max_zoom: 17,
    });
    expect(mapView(doc)).toEqual({ lat: 50.7, lng: 7.1, zoom: 12, minZoom: 4, maxZoom: 17, saved: true });
    expect(doc.dirty).toBe(true);
  });
  it('refuses min above max and a zoom outside the bounds with the field, and changes nothing', () => {
    const doc = open();
    const bad = setMapView(doc, { lat: 50, lng: 7, zoom: 8, minZoom: 12, maxZoom: 5 });
    expect(bad).toMatchObject({
      ok: false,
      code: 'invalid',
      fields: [{ field: 'minZoom', code: 'min_above_max' }],
    });
    expect(setMapView(doc, { lat: 50, lng: 7, zoom: 3, minZoom: 5, maxZoom: 9 })).toMatchObject({
      ok: false,
      fields: [{ field: 'zoom', code: 'zoom_below_min' }],
    });
    expect(doc.dirty).toBe(false);
  });
  it('property: any later valid save succeeds, whatever the earlier one was', () => {
    const z = fc.integer({ min: 0, max: 24 });
    const view = fc
      .tuple(z, z, z)
      .map(([a, b, c]) => [a, b, c].sort((x, y) => x - y))
      .map(([minZoom, zoom, maxZoom]) => ({
        lat: 50,
        lng: 7,
        zoom: zoom ?? 0,
        minZoom: minZoom ?? 0,
        maxZoom: maxZoom ?? 0,
      }));
    fc.assert(
      fc.property(view, view, (first, second) => {
        const next = setMapView(must(setMapView(open(), first)), second);
        expect(next.ok).toBe(true);
        if (next.ok) expect(mapView(next.doc)).toEqual({ ...second, saved: true });
      }),
      { numRuns: 40 },
    );
  });
});
