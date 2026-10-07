// @vitest-environment jsdom
// WP-621: v3's "Kartenlayer" sheet: one base at a time (radio), overlays on and off (switches), a label each.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { MapConfig } from '@ueberblick/core/model';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import { memoryChoice } from './layer-prefs.testing';
import LayerSheet from './LayerSheet.svelte';
import { createLayerController } from './layer-controller';

const map = {
  layers: {
    osm: {
      label: { de: 'Straße', en: 'Streets' },
      kind: 'base',
      source: { type: 'preset', preset: 'osm' },
      on_at_start: true,
    },
    luft: {
      label: { de: 'Luftbild', en: 'Aerial' },
      kind: 'base',
      source: { type: 'xyz', url: 'https://t/{z}/{x}/{y}.jpg' },
    },
    flur: {
      label: { de: 'Flurstücke', en: 'Parcels' },
      kind: 'overlay',
      source: { type: 'geojson', url: '/f.geojson' },
    },
  },
} as unknown as MapConfig;

function open(locale: 'de' | 'en' = 'de', m: MapConfig | null = map) {
  const controller = createLayerController({ map: m ?? undefined, store: memoryChoice() });
  const view = render(LayerSheet, { open: true, controller, locale });
  return { controller, ...view };
}

describe('LayerSheet', () => {
  it('does not lock the rest of the shell: with the sheet open the page keeps taking taps (v3: the bar stays usable)', async () => {
    open();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.style.pointerEvents).not.toBe('none');
  });
  it('shows v3 Kartenlayer without an overlay, so the map stays usable', () => {
    open();
    expect(screen.getByText('Kartenlayer')).toBeTruthy();
    expect(screen.getByText('Basiskarte und Overlay-Layer auswählen')).toBeTruthy();
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
  });

  it('lists bases as radios and overlays as switches, each with its label; the start selection is on', () => {
    open();
    expect(screen.getByText('Basiskarten')).toBeTruthy();
    expect(screen.getByText('Overlay-Layer')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Straße' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Luftbild' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Flurstücke' }).getAttribute('aria-checked')).toBe('false');
  });

  it('picking a base swaps it; flipping a switch toggles the overlay', async () => {
    const { controller } = open();
    await fireEvent.click(screen.getByRole('radio', { name: 'Luftbild' }));
    expect(controller.selection().base).toBe('luft');
    expect(screen.getByRole('radio', { name: 'Luftbild' }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(screen.getByRole('switch', { name: 'Flurstücke' }));
    expect(controller.selection().overlays).toEqual(['flur']);
    await fireEvent.click(screen.getByRole('switch', { name: 'Flurstücke' }));
    expect(controller.selection().overlays).toEqual([]);
  });

  it('follows a change made elsewhere', async () => {
    const { controller } = open();
    controller.setBase('luft');
    await Promise.resolve();
    expect(screen.getByRole('radio', { name: 'Luftbild' }).getAttribute('aria-checked')).toBe('true');
  });

  it('hides a section that has no layers', () => {
    const onlyBase = { layers: { osm: map.layers['osm'] } } as unknown as MapConfig;
    open('de', onlyBase);
    expect(screen.queryByText('Overlay-Layer')).toBeNull();
  });

  it('says so for a project without layers', () => {
    open('de', null);
    expect(screen.getByText('Keine Layer für dieses Projekt konfiguriert')).toBeTruthy();
  });

  it('speaks English from the catalogue, with the English layer labels', () => {
    open('en');
    expect(screen.getByText('Map layers')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Aerial' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { baseElement } = open();
    expect(await axeViolations(baseElement.querySelector('[data-slot="sheet-content"]') as Element)).toEqual(
      [],
    );
  });

  it('every string it uses is in both catalogues, really translated', () => {
    const read = (l: string) =>
      JSON.parse(
        readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), '../../../../../messages', `${l}.json`),
          'utf8',
        ),
      ) as Record<string, string>;
    const de = read('de');
    const en = read('en');
    const keys = Object.keys(de).filter((k) => k.startsWith('participant_layer_'));
    expect(keys.length).toBe(5);
    for (const k of keys) {
      expect(en[k]).toBeTruthy();
      expect(en[k]).not.toBe(de[k]);
    }
  });
});
