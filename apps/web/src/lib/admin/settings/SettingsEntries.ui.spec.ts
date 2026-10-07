// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import { toast } from 'svelte-sonner';
import { draftStatus } from '../draft/status-store.svelte';
import { deployOverview } from '../deploy/overview-store.svelte';
import { overlayItem, rowOf, setViewport, shimLayout } from '../participants/page.testkit';
import SettingsPage from './SettingsPage.svelte';
import type { SettingsApi } from './api';
import type { PackStatus } from '@ueberblick/server';
import type { LifecycleView, SettingsPageData } from './types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
// no WebGL in jsdom: the region map is stood in for (the real one runs in the e2e)
vi.mock('./RegionSelector.svelte', async () => ({
  default: (await import('./RegionSelector.testing.svelte')).default,
}));

shimLayout();
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  vi.clearAllMocks();
});

const LIVE: LifecycleView = {
  version: 3,
  neverPublished: false,
  dirty: false,
  types: [],
  other: [],
  blockerCount: 0,
};
const BASE: SettingsPageData = {
  projectName: 'Musterstadt',
  branding: { name: '', icon: null },
  map: { lat: 50.7, lng: 7.1, zoom: 10, minZoom: 1, maxZoom: 19, saved: true },
  layers: { layers: [], roles: [] },
  infoPages: [],
  packs: [],
  packLayers: [],
  roles: [],
  mapConfig: null,
  template: { key: 't', label: 'T', version: '1.0.0', inputs: [] },
  chat: { enabled: false, all: false, roles: [], options: [] },
  startup: { layers: [], types: [] },
  cluster: { declared: false, roles: [] },
  fieldFilters: { declared: false, roles: [] },
  lifecycle: LIVE,
};
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const api = (over: Partial<Record<keyof SettingsApi, unknown>> = {}) =>
  ({
    saveBranding: vi.fn(() => ok(BASE)),
    saveMap: vi.fn(() => ok(BASE)),
    uploadIcon: vi.fn(),
    saveInfoPage: vi.fn(() => ok(BASE)),
    deleteInfoPage: vi.fn(() => ok(BASE)),
    savePack: vi.fn(() => ok(BASE)),
    savePackRoles: vi.fn(() => ok(BASE)),
    deletePack: vi.fn(() => ok(BASE)),
    packStatuses: vi.fn(() => ok([])),
    rebuildPack: vi.fn(() => ok({})),
    ...over,
  }) as unknown as SettingsApi & Record<keyof SettingsApi, ReturnType<typeof vi.fn>>;

function mount(section: string, data: Partial<SettingsPageData> = {}, a = api()) {
  const reload = vi.fn(() => Promise.resolve());
  render(SettingsPage, {
    data: { ...BASE, ...data },
    locale: 'de',
    project: 'musterstadt',
    api: a,
    reload,
    current: section,
    onselect: vi.fn(),
  });
  return { api: a, reload };
}

const SIZES = [
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
] as const;

describe.each(SIZES)('Infoseiten at %s', (_n, width) => {
  beforeEach(() => setViewport(width));
  const PAGES = [
    {
      key: 'datenschutz',
      title: 'Datenschutz',
      content: '<h2>Daten</h2><p>Wir <b>speichern</b> wenig.</p>',
      sortOrder: 2,
    },
  ];

  it("shows v3's empty state and no list", () => {
    mount('info-pages');
    expect(screen.getByRole('heading', { level: 2, name: 'Infoseiten' })).toBeTruthy();
    expect(screen.getByTestId('info-empty').textContent).toContain('Keine Infoseiten');
  });

  it('lists a page with its text without markup and its Sortierung, and the sidebar dot is on', () => {
    mount('info-pages', { infoPages: PAGES });
    const card = screen.getByTestId('info-page');
    expect(card.textContent).toContain('Datenschutz');
    expect(card.textContent).toContain('Daten Wir speichern wenig.');
    expect(card.textContent).not.toContain('<b>');
    expect(card.textContent).toContain('Sortierung: 2');
  });

  it('creates a page: the dialog lists the four variables, saves into the draft and tells the shell', async () => {
    const { api: a, reload } = mount('info-pages');
    const before = draftStatus.changes;
    await userEvent.click(screen.getByRole('button', { name: 'Infoseite hinzufügen' }));
    const vars = await screen.findByTestId('info-variables');
    for (const v of ['$token', '$loginlink', '$qrtoken', '$qrloginlink'])
      expect(vars.textContent).toContain(v);
    await userEvent.type(screen.getByLabelText('Titel'), 'Impressum');
    await userEvent.type(screen.getByLabelText('Inhalt'), '<p>Hallo $token</p>');
    await userEvent.type(screen.getByLabelText('Sortierung'), '3'); // typed into a number input: it binds a number
    await userEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
    await waitFor(() =>
      expect(a.saveInfoPage).toHaveBeenCalledWith({
        title: 'Impressum',
        content: '<p>Hallo $token</p>',
        sortOrder: 3,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Infoseite erfolgreich erstellt'));
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('refuses an empty title in the form and sends nothing', async () => {
    const { api: a } = mount('info-pages');
    await userEvent.click(screen.getByRole('button', { name: 'Infoseite hinzufügen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Erstellen' }));
    expect(await screen.findByText('Bitte einen Titel eingeben')).toBeTruthy();
    expect(a.saveInfoPage).not.toHaveBeenCalled();
  });

  it('edits with the key and the values already there', async () => {
    const { api: a } = mount('info-pages', { infoPages: PAGES });
    await userEvent.click(screen.getByRole('button', { name: 'Infoseite bearbeiten' }));
    const title = (await screen.findByLabelText('Titel')) as HTMLInputElement;
    expect(title.value).toBe('Datenschutz');
    expect((screen.getByLabelText('Sortierung') as HTMLInputElement).value).toBe('2');
    await userEvent.clear(title);
    await userEvent.type(title, 'Datenschutz neu');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(a.saveInfoPage).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'datenschutz', title: 'Datenschutz neu', sortOrder: 2 }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Infoseite erfolgreich aktualisiert'));
  });

  it('deletes with the second click (v3: the trash turns into a red Löschen)', async () => {
    const { api: a } = mount('info-pages', { infoPages: PAGES });
    const card = screen.getByTestId('info-page');
    await userEvent.click(within(card).getByRole('button', { name: 'Löschen' }));
    expect(a.deleteInfoPage).not.toHaveBeenCalled();
    await userEvent.click(within(card).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(a.deleteInfoPage).toHaveBeenCalledWith('datenschutz'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Infoseite erfolgreich gelöscht'));
  });

  it('shows the refusal of a failed save', async () => {
    mount(
      'info-pages',
      {},
      api({ saveInfoPage: vi.fn(() => Promise.resolve({ ok: false, message: 'Entwurf geändert' })) }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Infoseite hinzufügen' }));
    await userEvent.type(await screen.findByLabelText('Titel'), 'X');
    await userEvent.type(screen.getByLabelText('Inhalt'), 'Y');
    await userEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Entwurf geändert'));
  });
});

describe.each(SIZES)('Status & Freigabe at %s', (_n, width) => {
  beforeEach(() => setViewport(width));
  it('live and clean: the version, no button, a link to the versions', () => {
    mount('lifecycle');
    const box = screen.getByTestId('life-status');
    expect(box.dataset['state']).toBe('live');
    expect(box.textContent).toContain('Live — Version 3');
    expect(screen.queryByRole('button', { name: /Live schalten|Veröffentlichen/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Versionen ansehen' }).getAttribute('href')).toBe(
      '/admin/projects/musterstadt/versions',
    );
  });

  it('never published: the draft box, the Objektarten with their object count, "Live schalten"', () => {
    mount('lifecycle', {
      lifecycle: {
        ...LIVE,
        version: null,
        neverPublished: true,
        dirty: true,
        types: [{ key: 'baum', label: 'Baum', objects: 12, blockers: [] }],
      },
    });
    expect(screen.getByTestId('life-status').dataset['state']).toBe('draft');
    expect(screen.getByTestId('life-types').textContent).toContain('Baum');
    expect(screen.getByTestId('life-types').textContent).toContain('12 Objekte vorhanden');
    expect((screen.getByRole('button', { name: 'Live schalten' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('blockers are listed under their Objektart with a link to its builder, and block the button', () => {
    mount('lifecycle', {
      lifecycle: {
        ...LIVE,
        dirty: true,
        types: [{ key: 'baum', label: 'Baum', objects: 1, blockers: ['Option fehlt'] }],
        other: ['Rolle unbekannt'],
        blockerCount: 2,
      },
    });
    expect(screen.getByText('Option fehlt')).toBeTruthy();
    expect(screen.getByText('Rolle unbekannt')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Im Builder öffnen' }).getAttribute('href')).toBe(
      '/admin/projects/musterstadt/types/baum/builder',
    );
    expect(
      screen.getByText('Vor der Veröffentlichung müssen die oben genannten Probleme behoben werden.'),
    ).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Veröffentlichen' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('opens the deploy overview, the one the publish bar opens', async () => {
    mount('lifecycle', { lifecycle: { ...LIVE, dirty: true } });
    deployOverview.open = false;
    await userEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));
    expect(deployOverview.open).toBe(true);
    deployOverview.open = false;
  });

  it('reads the state again after a deploy from the overview', async () => {
    const { reload } = mount('lifecycle', { lifecycle: { ...LIVE, dirty: true } });
    deployOverview.published = 5;
    await waitFor(() => expect(reload).toHaveBeenCalled());
    deployOverview.published = null;
  });
});

const LAYERS = [
  { key: 'osm', label: 'Straßenkarte', base: true, packable: true },
  { key: 'flur', label: 'Flur', base: false, packable: false },
];
const PACK_ROW = {
  key: 'innen',
  name: 'Innenstadt',
  bounds: [7.08, 50.7, 7.14, 50.75] as const,
  minZoom: 12,
  maxZoom: 14,
  layers: ['osm'],
  roles: ['kontrolle'],
};
const status = (state: PackStatus['state'], error: string | null = null): PackStatus =>
  ({
    key: 'innen',
    label: 'Innenstadt',
    bounds: [7.08, 50.7, 7.14, 50.75],
    min_zoom: 12,
    max_zoom: 14,
    roles: ['kontrolle'],
    hash: 'h',
    estimate: { tiles: 120, bytes: 1 },
    state,
    progress: { tiles_done: 60, tiles_total: 120, bytes: 1 },
    bytes: 2048,
    built_at: null,
    error,
    layers: [
      {
        layer: 'osm',
        state,
        progress: { tiles_done: 0, tiles_total: 0, bytes: 0 },
        max_zoom: 14,
        tiles: 99,
        sha256: null,
        error,
        estimate: { tiles: 120, bytes: 1, max_zoom: 14 },
      },
    ],
  }) as PackStatus;
const ROLES = [{ key: 'kontrolle', label: 'Kontrolle', description: '' }];

describe.each(SIZES)('Offline-Pakete at %s', (_n, width) => {
  beforeEach(() => setViewport(width));
  it("without layers: v3's empty state and a disabled create button", () => {
    mount('offline-packs');
    expect(screen.getByTestId('pack-empty-layers').textContent).toContain('Keine Kartenebenen konfiguriert');
    expect((screen.getByRole('button', { name: 'Paket erstellen' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('with layers and no pack: the second empty state offers to create', () => {
    mount('offline-packs', { packLayers: LAYERS });
    expect(screen.getByTestId('pack-empty').textContent).toContain('Keine Offline-Pakete');
  });

  it('the table follows the build: draft, then ready with real tiles and size', async () => {
    mount(
      'offline-packs',
      { packLayers: LAYERS, roles: ROLES, packs: [PACK_ROW] },
      api({ packStatuses: vi.fn(() => ok([status('ready')])) }),
    );
    await waitFor(() =>
      expect(within(rowOf('innen')).getByTestId('pack-status').dataset['state']).toBe('ready'),
    );
    const row = rowOf('innen');
    expect(row.textContent).toContain('Innenstadt');
    expect(row.textContent).toContain('12-14');
    expect(row.textContent).toContain('99');
    expect(row.textContent).toContain('2.0 KB');
  });

  it('a failed build shows its reason and "Neu bauen" retries it', async () => {
    const a = api({ packStatuses: vi.fn(() => ok([status('failed', 'tile host down')])) });
    mount('offline-packs', { packLayers: LAYERS, roles: ROLES, packs: [PACK_ROW] }, a);
    await waitFor(() => expect(within(rowOf('innen')).getByText('tile host down')).toBeTruthy());
    await userEvent.click(within(rowOf('innen')).getByRole('button', { name: 'Neu bauen' }));
    await waitFor(() => expect(a.rebuildPack).toHaveBeenCalledWith('innen'));
  });

  it("create: layers it can pack are on, a base is badged, one it cannot pack is off; v3's checks come in v3's order", async () => {
    const { api: a } = mount('offline-packs', { packLayers: LAYERS, roles: ROLES });
    await userEvent.click(screen.getAllByRole('button', { name: 'Paket erstellen' })[0] as HTMLElement);
    const dialog = await screen.findByTestId('pack-dialog');
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(dialog.textContent).toContain('Basis');
    expect(dialog.textContent).toContain('kann nicht gepackt werden');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Paket erstellen' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Bitte zeichnen Sie eine Region auf der Karte'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Region auf der Karte zeichnen/ }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Region zeichnen (Test)' }));
    await waitFor(() => expect(within(dialog).getByTestId('pack-region').textContent).toContain('km²'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Paket erstellen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Paketname ist erforderlich'));
    await userEvent.type(within(dialog).getByLabelText('Paketname'), 'Innenstadt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Paket erstellen' }));
    await waitFor(() =>
      expect(a.savePack).toHaveBeenCalledWith({
        name: 'Innenstadt',
        minZoom: 10,
        maxZoom: 16,
        bounds: [7.08, 50.7, 7.14, 50.75],
        layers: ['osm'],
        roles: [],
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Paket erstellt. Es wird nach dem Veröffentlichen gebaut.'),
    );
  });
  it('delete asks first, names the pack and then deletes from the draft', async () => {
    const { api: a } = mount('offline-packs', { packLayers: LAYERS, roles: ROLES, packs: [PACK_ROW] });
    await waitFor(() => expect(rowOf('innen')).toBeTruthy());
    await userEvent.click(within(rowOf('innen')).getByRole('button', { name: 'Menü öffnen' }));
    await userEvent.click(await overlayItem('menuitem', 'Löschen'));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Innenstadt');
    expect(a.deletePack).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(a.deletePack).toHaveBeenCalledWith('innen'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Paket gelöscht'));
  });
});
