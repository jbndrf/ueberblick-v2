// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { overwriteGetLocale } from '../../../../../../packages/ui/src/paraglide/runtime.js';
import type * as Sonner from 'svelte-sonner';
import { toast } from 'svelte-sonner';
import { overlayItem, rowOf, setViewport, shimLayout } from '../participants/page.testkit';
import { draftStatus } from '../draft/status-store.svelte';
import SettingsPage from './SettingsPage.svelte';
import type { SettingsApi } from './api';
import type { LayerRowData } from './layers-model';
import type { SettingsPageData } from './types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

shimLayout();
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  vi.clearAllMocks();
  overwriteGetLocale(() => 'en');
});

const layer = (over: Partial<LayerRowData> & Pick<LayerRowData, 'key' | 'label'>): LayerRowData => ({
  kind: 'overlay',
  type: 'xyz',
  opacity: 100,
  roles: [],
  onAtStart: false,
  proxied: true,
  url: 'https://tiles.example.org/{z}/{x}/{y}.png',
  preset: '',
  attribution: '',
  minzoom: null,
  maxzoom: null,
  source: { type: 'xyz', url: 'https://tiles.example.org/{z}/{x}/{y}.png' },
  ...over,
});
const OSM = layer({
  key: 'osm',
  label: 'Straßenkarte',
  kind: 'base',
  type: 'preset',
  url: '',
  preset: 'osm',
  onAtStart: true,
  source: { type: 'preset', preset: 'osm' },
});
const FLUR = layer({ key: 'flur', label: 'Flurstücke', opacity: 60, roles: ['kontrolle'] });
const ROLES = [
  { key: 'kontrolle', label: 'Baumkontrolle' },
  { key: 'bauhof', label: 'Bauhof' },
];
/** Only the page fields this section reads; the other sections' data stay out of this spec. */
const data = (layers: LayerRowData[]): SettingsPageData =>
  ({
    projectName: 'Musterstadt',
    branding: { name: '', icon: null },
    map: { lat: 51.1657, lng: 10.4515, zoom: 10, minZoom: 1, maxZoom: 19, saved: false },
    chat: { enabled: false, all: true, roles: [], options: [] },
    layers: { layers, roles: ROLES },
    startup: { layers: [], types: [] },
    cluster: { declared: false, roles: [] },
    fieldFilters: { declared: false, roles: [] },
    lifecycle: { version: 1, neverPublished: false, dirty: false, types: [], other: [], blockerCount: 0 },
    infoPages: [],
    packs: [],
    packLayers: [],
    mapConfig: null,
    template: { key: 't', label: 'T', version: '1.0.0', inputs: [] },
  }) as unknown as SettingsPageData;
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

function mount(layers: LayerRowData[] = [OSM, FLUR], locale: 'de' | 'en' = 'de') {
  const saveLayers = vi.fn((...args: unknown[]) => ok(args.length >= 0 ? data(layers) : data([])));
  const api = { saveLayers } as unknown as SettingsApi;
  const reload = vi.fn(() => Promise.resolve());
  render(SettingsPage, {
    data: data(layers),
    locale,
    project: 'musterstadt',
    api,
    reload,
    current: 'layers',
    onselect: vi.fn(),
  });
  return { saveLayers, reload };
}

async function rowAction(user: ReturnType<typeof userEvent.setup>, id: string, name: string): Promise<void> {
  document.body.style.pointerEvents = ''; // the menu before this one has not finished closing
  await user.click(within(rowOf(id)).getByRole('button', { name: 'Menü öffnen' }));
  await user.click(await overlayItem('menuitem', name));
}

const SIZES = [
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
] as const;

describe.each(SIZES)('Kartenebenen at %s (v3 LayersSection.svelte)', (_n, width) => {
  beforeEach(() => setViewport(width));

  it('is the "Kartenebenen" entry of the Karte group; the heading names the base layers, the columns are v3 plus v4', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Kartenebenen' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Kartenebenen' })).toBeTruthy();
    expect(screen.getByText('Basis-Layer: Straßenkarte')).toBeTruthy();
    for (const label of [
      'Layer-Name',
      'Typ',
      'Deckkraft',
      'Sichtbar für Rollen',
      'Basis',
      'Reihenfolge',
      'Abruf',
    ])
      expect(screen.getByRole('columnheader', { name: new RegExp(label) })).toBeTruthy();
    expect(within(rowOf('flur')).getByText('Flurstücke')).toBeTruthy();
    expect(within(rowOf('flur')).getByText('60')).toBeTruthy();
    expect(within(rowOf('flur')).getByText('Über den Server')).toBeTruthy();
  });

  it('is English when the admin chose English', () => {
    mount([OSM], 'en');
    expect(screen.getByRole('heading', { level: 2, name: 'Map layers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add layer' })).toBeTruthy();
  });

  it('with no layer: the empty state (map icon, title, hint) and the hint to add a base', async () => {
    const user = userEvent.setup();
    mount([]);
    expect(screen.getByText('Kein Basis-Layer konfiguriert', { exact: false })).toBeTruthy();
    const empty = screen.getByTestId('layers-empty');
    expect(within(empty).getByText('Noch keine Layer')).toBeTruthy();
    await user.click(within(empty).getByRole('button', { name: 'Layer hinzufügen' }));
    expect(await screen.findByRole('dialog', { name: 'Kartenebene hinzufügen' })).toBeTruthy();
  });

  it('add dialog, Voreinstellungen: a preset already on shows "Hinzugefügt" and cannot be added again', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getAllByRole('button', { name: 'Layer hinzufügen' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Kartenebene hinzufügen' });
    const preset = within(dialog).getByRole('button', {
      name: /^OpenStreetMap(?! Germany)/,
    }) as HTMLButtonElement;
    expect(preset.disabled).toBe(true);
    expect(within(dialog).getByText('Hinzugefügt')).toBeTruthy();
  });

  it('add dialog, Voreinstellungen: the first preset is the base, a later one an overlay (v3 handleAddPreset)', async () => {
    const user = userEvent.setup();
    const { saveLayers, reload } = mount([]);
    const before = draftStatus.changes;
    await user.click(screen.getAllByRole('button', { name: 'Layer hinzufügen' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Kartenebene hinzufügen' });
    await user.click(within(dialog).getByRole('button', { name: /^OpenStreetMap(?! Germany)/ }));
    await waitFor(() =>
      expect(saveLayers).toHaveBeenCalledWith({
        op: 'add',
        layer: { label: 'OpenStreetMap', kind: 'base', source: { type: 'preset', preset: 'osm' } },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Layer hinzugefügt');
    expect(reload).toHaveBeenCalled();
    expect(draftStatus.changes).toBeGreaterThan(before);
  });

  it("add dialog, Voreinstellungen: v3's presets in v3's order; a WMS preset becomes an ordinary wms layer", async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount([OSM]);
    await user.click(screen.getAllByRole('button', { name: 'Layer hinzufügen' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Kartenebene hinzufügen' });
    const names = within(dialog)
      .getAllByRole('button', { name: /Zoom 0-/ })
      .map((b) => b.querySelector('.font-medium')?.textContent);
    expect(names).toEqual([
      'OpenStreetMap',
      'OpenStreetMap Germany',
      'CartoDB Positron (Hell)',
      'CartoDB Dark Matter',
      'NRW Orthofoto (Satellit)',
      'NRW Topographische Karte',
    ]);
    await user.click(within(dialog).getByRole('button', { name: /NRW Topographische Karte/ }));
    await waitFor(() =>
      expect(saveLayers).toHaveBeenCalledWith({
        op: 'add',
        layer: {
          label: 'NRW Topographische Karte',
          kind: 'overlay',
          source: {
            type: 'wms',
            url: 'https://www.wms.nrw.de/geobasis/wms_nw_dtk',
            layers: 'nw_dtk_col',
            version: '1.1.1',
            format: 'image/png',
            transparent: false,
          },
          attribution: 'Geobasis NRW',
        },
      }),
    );
  });

  it('add dialog, Kachel-URL: the button waits for name and URL; a URL without z/x/y is refused with the reason', async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount();
    await user.click(screen.getAllByRole('button', { name: 'Layer hinzufügen' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Kartenebene hinzufügen' });
    await user.click(within(dialog).getByRole('tab', { name: 'Kachel-URL' }));
    const panel = within(dialog.querySelector('[role="tabpanel"][data-state="active"]') as HTMLElement);
    const submit = panel.getByRole('button', { name: 'Layer hinzufügen' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(panel.getByLabelText('Name'), 'Orthofoto');
    await user.type(panel.getByLabelText('Kachel-URL-Vorlage'), 'https://x.org/tiles.png');
    await user.click(submit);
    expect((await panel.findByRole('alert')).textContent).toBe(
      'Die URL muss die Platzhalter z, x und y enthalten',
    );
    expect(saveLayers).not.toHaveBeenCalled();
    const url = panel.getByLabelText('Kachel-URL-Vorlage');
    await user.clear(url);
    await user.type(url, 'https://x.org/{{z}/{{x}/{{y}.png');
    await user.click(panel.getByLabelText('Als Basis-Layer festlegen'));
    await user.click(submit);
    await waitFor(() =>
      expect(saveLayers).toHaveBeenCalledWith({
        op: 'add',
        layer: {
          label: 'Orthofoto',
          kind: 'base',
          source: { type: 'xyz', url: 'https://x.org/{z}/{x}/{y}.png' },
        },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Kachelschicht hinzugefügt');
  });

  it('add dialog, WMS: Layers, Format, Version and Transparent are sent as v3 had them (version 1.1.1)', async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount();
    await user.click(screen.getAllByRole('button', { name: 'Layer hinzufügen' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Kartenebene hinzufügen' });
    await user.click(within(dialog).getByRole('tab', { name: 'WMS' }));
    const panel = within(dialog.querySelector('[role="tabpanel"][data-state="active"]') as HTMLElement);
    await user.type(panel.getByLabelText('Name'), 'Flur');
    await user.type(panel.getByLabelText('WMS-URL'), 'https://wms.example.org/ows');
    await user.type(panel.getByLabelText('Layer'), 'flur');
    await user.click(panel.getByRole('button', { name: '1.3.0' }));
    await user.click(panel.getByRole('button', { name: 'Layer hinzufügen' }));
    await waitFor(() =>
      expect(saveLayers).toHaveBeenCalledWith({
        op: 'add',
        layer: {
          label: 'Flur',
          kind: 'overlay',
          source: {
            type: 'wms',
            url: 'https://wms.example.org/ows',
            layers: 'flur',
            version: '1.3.0',
            format: 'image/png',
            transparent: true,
          },
        },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('WMS-Layer hinzugefügt');
  });

  it('a refusal of the server is a toast, and the dialog stays open with what was typed', async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount();
    saveLayers.mockImplementationOnce(() =>
      Promise.resolve({ ok: false as const, message: 'Abgelehnt' } as never),
    );
    await user.click(screen.getAllByRole('button', { name: 'Layer hinzufügen' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Kartenebene hinzufügen' });
    await user.click(within(dialog).getByRole('tab', { name: 'GeoJSON' }));
    const panel = within(dialog.querySelector('[role="tabpanel"][data-state="active"]') as HTMLElement);
    await user.type(panel.getByLabelText('Name'), 'Bäume');
    await user.type(panel.getByLabelText('GeoJSON-URL'), '/data/baeume.geojson');
    await user.click(panel.getByRole('button', { name: 'Layer hinzufügen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Abgelehnt'));
    expect(screen.getByRole('dialog', { name: 'Kartenebene hinzufügen' })).toBeTruthy();
    expect((panel.getByLabelText('Name') as HTMLInputElement).value).toBe('Bäume');
  });

  it('row menu: "Als Basis setzen" / "Als Overlay setzen" (v3 toggleLayerType)', async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount();
    await rowAction(user, 'flur', 'Als Basis setzen');
    await waitFor(() =>
      expect(saveLayers).toHaveBeenCalledWith({ op: 'update', key: 'flur', patch: { kind: 'base' } }),
    );
    expect(toast.success).toHaveBeenCalledWith('Layer als Basis festgelegt');
    await rowAction(user, 'osm', 'Als Overlay setzen');
    await waitFor(() =>
      expect(saveLayers).toHaveBeenCalledWith({ op: 'update', key: 'osm', patch: { kind: 'overlay' } }),
    );
  });

  it('row menu: Nach unten and Nach oben send the whole order; the ends do nothing', async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount();
    await rowAction(user, 'osm', 'Nach unten');
    await waitFor(() => expect(saveLayers).toHaveBeenCalledWith({ op: 'order', keys: ['flur', 'osm'] }));
    saveLayers.mockClear();
    await rowAction(user, 'osm', 'Nach oben');
    expect(saveLayers).not.toHaveBeenCalled();
  });

  it('delete: v3 confirm with the name, and a "base" badge for the base layer; Löschen removes it', async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount();
    await rowAction(user, 'osm', 'Löschen');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Kartenebene löschen')).toBeTruthy();
    expect(within(dialog).getByText('Straßenkarte')).toBeTruthy();
    expect(within(dialog).getByText('Dies ist die Basis-Layer')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(saveLayers).not.toHaveBeenCalled();
    await rowAction(user, 'flur', 'Löschen');
    const again = await screen.findByRole('alertdialog');
    expect(within(again).queryByText('Dies ist die Basis-Layer')).toBeNull();
    await user.click(within(again).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(saveLayers).toHaveBeenCalledWith({ op: 'remove', key: 'flur' }));
    expect(toast.success).toHaveBeenCalledWith('Kartenebene gelöscht');
  });

  it('in Bearbeitungsmodus: the name and the opacity change in the table', async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount();
    await user.click(screen.getByRole('switch', { name: 'Bearbeitungsmodus' }));
    await user.click(within(rowOf('flur')).getByRole('button', { name: /Flurstücke/ }));
    const input = within(rowOf('flur')).getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Flur neu{Enter}');
    await waitFor(() =>
      expect(saveLayers).toHaveBeenCalledWith({ op: 'update', key: 'flur', patch: { label: 'Flur neu' } }),
    );
  });

  it('Bearbeiten: every setting of the layer; saving sends the whole patch, an emptied role list takes the roles away', async () => {
    const user = userEvent.setup();
    const { saveLayers } = mount();
    await rowAction(user, 'flur', 'Bearbeiten');
    const dialog = await screen.findByRole('dialog', { name: 'Layer bearbeiten' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Flurstücke');
    expect((within(dialog).getByLabelText('Kachel-URL-Vorlage') as HTMLInputElement).value).toBe(
      'https://tiles.example.org/{z}/{x}/{y}.png',
    );
    expect((within(dialog).getByLabelText('Deckkraft') as HTMLInputElement).value).toBe('60');
    await user.type(within(dialog).getByLabelText('Quellenangabe (optional)'), 'Land NRW');
    await user.type(within(dialog).getByLabelText('Sichtbar ab Zoom'), '5');
    await user.click(within(dialog).getByLabelText('Beim Start eingeschaltet'));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(saveLayers).toHaveBeenCalled());
    expect(saveLayers.mock.calls[0]?.[0]).toEqual({
      op: 'update',
      key: 'flur',
      patch: {
        label: 'Flurstücke',
        kind: 'overlay',
        source: { type: 'xyz', url: 'https://tiles.example.org/{z}/{x}/{y}.png' },
        attribution: 'Land NRW',
        opacity: 0.6,
        minzoom: 5,
        maxzoom: null,
        roles: ['kontrolle'],
        on_at_start: true,
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Layer aktualisiert');
  });

  it('Bearbeiten of a preset: the source is fixed, no URL field', async () => {
    const user = userEvent.setup();
    mount();
    await rowAction(user, 'osm', 'Bearbeiten');
    const dialog = await screen.findByRole('dialog', { name: 'Layer bearbeiten' });
    expect(within(dialog).queryByLabelText('Kachel-URL-Vorlage')).toBeNull();
    expect(within(dialog).getByText(/Die Quelle dieser Voreinstellung ist fest/)).toBeTruthy();
    expect(within(dialog).getByLabelText('Standard-Basiskarte beim Start')).toBeTruthy();
  });
});
