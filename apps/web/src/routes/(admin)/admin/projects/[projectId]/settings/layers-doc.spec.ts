import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { orderedLayerKeys } from '@ueberblick/core';
import { embedGoldenSource } from '@ueberblick/core/testing';
import {
  layerKeyFor,
  layerRows,
  validateLayerDraft,
  type LayerDraft,
  type LayerOp,
} from '../../../../../../lib/admin/settings/layers-model';
import { applyLayerOp } from './layers-doc';
import type { SettingsEdit } from './settings-doc';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
// The template brings one base layer, `osm`.
const open = (): Doc =>
  openProject(golden('templates/baumkataster/1.1.0.yaml'), golden('projects/musterstadt-baeume.yaml'));
const must = (r: SettingsEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const run = (doc: Doc, op: LayerOp): SettingsEdit => applyLayerOp(doc, op, 'de');
const keys = (doc: Doc): string[] => Object.keys(doc.effective().map?.layers ?? {});
const rows = (doc: Doc) => layerRows(doc.effective().map, 'de');

const TILES: LayerDraft = {
  label: 'Orthofoto',
  kind: 'overlay',
  source: { type: 'xyz', url: 'https://tiles.example.org/{z}/{x}/{y}.png' },
};
const WMS: LayerDraft = {
  label: 'Flurstücke',
  kind: 'overlay',
  source: { type: 'wms', url: 'https://wms.example.org/ows', layers: 'flur', version: '1.3.0' },
  attribution: 'Land',
  opacity: 0.5,
  roles: ['kontrolle'],
};
const add = (doc: Doc, layer: LayerDraft): Doc => must(run(doc, { op: 'add', layer }));

describe('add', () => {
  it('adds an xyz layer as an overlay entry, with a key made from its name', () => {
    const doc = add(open(), TILES);
    expect(doc.dirty).toBe(true);
    expect(keys(doc)).toEqual(['osm', 'orthofoto']);
    expect(doc.effective().map?.layers['orthofoto']).toEqual({
      label: 'Orthofoto',
      kind: 'overlay',
      source: TILES.source,
    });
    expect(doc.problems()).toEqual(open().problems());
  });
  it('adds a wms layer with its attribution, opacity and roles', () => {
    const layer = add(open(), WMS).effective().map?.layers['flurstucke'];
    expect(layer).toMatchObject({ attribution: 'Land', opacity: 0.5, roles: ['kontrolle'] });
  });
  it('gives a second layer of the same name its own key', () => {
    expect(keys(add(add(open(), TILES), TILES))).toEqual(['osm', 'orthofoto', 'orthofoto_2']);
  });
  it('refuses a form that is wrong, with the check that failed', () => {
    expect(run(open(), { op: 'add', layer: { ...TILES, label: ' ' } })).toMatchObject({
      ok: false,
      code: 'layer_invalid',
      layer: 'name_required',
    });
    const noPlaceholders = { ...TILES, source: { type: 'xyz', url: 'https://x.org/tiles.png' } } as const;
    expect(run(open(), { op: 'add', layer: noPlaceholders })).toMatchObject({ layer: 'tile_placeholders' });
    expect(
      validateLayerDraft({ ...TILES, source: { type: 'wms', url: 'https://x.org/w', layers: '' } }),
    ).toBe('wms_layers_required');
    expect(
      validateLayerDraft({ ...TILES, source: { type: 'pmtiles', url: '/t.pmtiles', tile_type: 'vector' } }),
    ).toBe('source_layer_required');
  });
  it('a new default base takes the default away from the one before', () => {
    const base: LayerDraft = {
      label: 'Luftbild',
      kind: 'base',
      source: { type: 'xyz', url: 'https://a.org/{z}/{x}/{y}.jpg' },
      on_at_start: true,
    };
    const doc = add(open(), base);
    expect(rows(doc).map((r) => [r.key, r.onAtStart])).toEqual([
      ['osm', false],
      ['luftbild', true],
    ]);
  });
});

describe('update', () => {
  it('changes opacity, roles and attribution of a layer the template brought (an override)', () => {
    let doc = must(
      run(open(), {
        op: 'update',
        key: 'osm',
        patch: { opacity: 0.4, roles: ['kontrolle'], attribution: 'OSM' },
      }),
    );
    expect(rows(doc)[0]).toMatchObject({ opacity: 40, roles: ['kontrolle'], attribution: 'OSM' });
    doc = must(run(doc, { op: 'update', key: 'osm', patch: { opacity: 1, roles: [], attribution: null } }));
    expect(rows(doc)[0]).toMatchObject({ opacity: 100, roles: [], attribution: '' });
  });
  it('edits the source and the name; a name per language changes only the page language', () => {
    let doc = add(open(), TILES);
    doc = must(
      run(doc, {
        op: 'update',
        key: 'orthofoto',
        patch: {
          label: 'Orthofoto 2026',
          source: { type: 'xyz', url: 'https://t2.example.org/{z}/{x}/{y}.png' },
        },
      }),
    );
    expect(rows(doc)[1]).toMatchObject({
      label: 'Orthofoto 2026',
      url: 'https://t2.example.org/{z}/{x}/{y}.png',
    });
    doc = must(run(doc, { op: 'update', key: 'osm', patch: { label: 'Karte' } }));
    expect(doc.effective().map?.layers['osm']?.label).toEqual({ de: 'Karte', en: 'Street map' });
  });
  it('base and overlay: changing the kind drops the old "on at start"; the default base is one', () => {
    let doc = add(open(), { ...TILES, label: 'Luftbild', kind: 'base' });
    doc = must(run(doc, { op: 'update', key: 'luftbild', patch: { on_at_start: true } }));
    expect(rows(doc).map((r) => r.onAtStart)).toEqual([false, true]);
    doc = must(run(doc, { op: 'update', key: 'luftbild', patch: { kind: 'overlay' } }));
    expect(rows(doc)[1]).toMatchObject({ kind: 'overlay', onAtStart: false });
  });
  it('refuses an unknown layer and an empty name', () => {
    expect(run(open(), { op: 'update', key: 'nope', patch: { opacity: 0.2 } })).toMatchObject({
      code: 'no_layer',
    });
    expect(run(open(), { op: 'update', key: 'osm', patch: { label: '' } })).toMatchObject({
      layer: 'name_required',
    });
  });
});

describe('remove', () => {
  it('drops a layer the overlay added, and hides one the template brought', () => {
    let doc = add(open(), TILES);
    doc = must(run(doc, { op: 'remove', key: 'orthofoto' }));
    expect(keys(doc)).toEqual(['osm']);
    expect(doc.overlay().add?.['map.layers.orthofoto']).toBeUndefined();
    doc = must(run(doc, { op: 'remove', key: 'osm' }));
    expect(keys(doc)).toEqual([]);
    expect(doc.template.map?.layers['osm']).toBeDefined();
  });
  it('takes the layer out of the order list too', () => {
    let doc = add(add(open(), TILES), WMS);
    doc = must(run(doc, { op: 'order', keys: ['flurstucke', 'osm', 'orthofoto'] }));
    doc = must(run(doc, { op: 'remove', key: 'osm' }));
    expect(doc.effective().map?.order).toEqual(['flurstucke', 'orthofoto']);
  });
  it('refuses to remove a layer an offline pack holds', () => {
    const packed = open().apply({
      kind: 'add',
      path: 'map.packs',
      value: {
        region: { label: 'Region', bounds: [7, 50, 8, 51], min_zoom: 8, max_zoom: 12, layers: ['osm'] },
      },
    });
    expect(packed.refused).toBeUndefined();
    const withPack = packed.doc;
    expect(run(withPack, { op: 'remove', key: 'osm' })).toMatchObject({ ok: false, code: 'layer_in_pack' });
  });
});

describe('order', () => {
  it('writes map.order; the rows follow it', () => {
    const doc = must(run(add(open(), TILES), { op: 'order', keys: ['orthofoto', 'osm'] }));
    expect(rows(doc).map((r) => r.key)).toEqual(['orthofoto', 'osm']);
  });
  it('refuses a list that is not every layer once', () => {
    const doc = add(open(), TILES);
    expect(run(doc, { op: 'order', keys: ['osm'] }).ok).toBe(false);
    expect(run(doc, { op: 'order', keys: ['osm', 'osm'] }).ok).toBe(false);
    expect(run(doc, { op: 'order', keys: ['osm', 'x'] }).ok).toBe(false);
  });
  it('property: any permutation is kept as the draw order, and the file stays valid', () => {
    const base = add(add(add(open(), TILES), WMS), { ...TILES, label: 'Dritte' });
    fc.assert(
      fc.property(fc.shuffledSubarray(keys(base), { minLength: 4, maxLength: 4 }), (order) => {
        const doc = must(run(base, { op: 'order', keys: order }));
        expect(orderedLayerKeys(doc.effective().map as never)).toEqual(order);
        expect(doc.problems()).toEqual(open().problems());
      }),
    );
  });
});

describe('layerKeyFor', () => {
  it('property: a key is a config key and not in use', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string({ maxLength: 6 }), { maxLength: 5 }), (label, taken) => {
        const key = layerKeyFor(label, taken);
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(taken).not.toContain(key);
      }),
    );
  });
  it('transliterates German names', () => {
    expect(layerKeyFor('Straßenkarte Süd', [])).toBe('strassenkarte_sud');
    expect(layerKeyFor('3D Gelände', [])).toBe('ebene_3d_gelande');
  });
});
