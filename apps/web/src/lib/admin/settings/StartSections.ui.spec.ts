// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { parse } from 'yaml';
import { compile, NO_ASSETS, serialize, TemplateFileSchema } from '@ueberblick/core';
import { embedGoldenSource } from '@ueberblick/core/testing';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import { toast } from 'svelte-sonner';
import { draftStatus } from '../draft/status-store.svelte';
import SettingsPage from './SettingsPage.svelte';
import type { SettingsApi } from './api';
import type { FiltersData } from './presets-types';
import type { ToolStartView } from './start-types';
import type { SettingsPageData } from './types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const golden = (rel: string): string =>
  embedGoldenSource(readFileSync(join(process.cwd(), 'fixtures/golden', rel), 'utf8'));
const compiled = compile(TemplateFileSchema.parse(parse(golden('templates/baumkataster/1.1.0.yaml'))), {
  assets: NO_ASSETS,
});
if (!compiled.ok) throw new Error('the golden template must compile');
const CONFIG = serialize(compiled.config);

const ROLES = [
  { key: 'kontrolle', label: 'Baumkontrolle' },
  { key: 'bauhof', label: 'Bauhof' },
];
const toolView = (states: readonly ('active' | 'offered' | 'none')[]): ToolStartView => ({
  declared: true,
  roles: ROLES.map((r, i) => ({ ...r, state: states[i] ?? 'none' })),
});
const DATA: SettingsPageData = {
  projectName: 'Musterstadt',
  branding: { name: '', icon: null },
  map: { lat: 51.1657, lng: 10.4515, zoom: 10, minZoom: 1, maxZoom: 19, saved: false },
  chat: { enabled: false, all: false, roles: [], options: [] },
  layers: { layers: [], roles: [] },
  startup: {
    types: [],
    layers: [
      { key: 'osm', label: 'Straßenkarte', kind: 'base', on: false },
      { key: 'luft', label: 'Luftbild', kind: 'base', on: true },
      { key: 'flur', label: 'Flurkarte', kind: 'overlay', on: true },
      { key: 'laerm', label: 'Lärmkarte', kind: 'overlay', on: false },
    ],
  },
  cluster: toolView(['offered', 'offered']),
  fieldFilters: toolView(['active', 'none']),
  infoPages: [],
  packs: [],
  packLayers: [],
  roles: [],
  mapConfig: null,
  template: { key: 't', label: 'T', version: '1.0.0', inputs: [] },
  lifecycle: { version: 1, neverPublished: false, dirty: false, types: [], other: [], blockerCount: 0 },
};
const FILTERS: FiltersData = {
  roles: ROLES,
  presets: [
    {
      key: 'kontrolliert',
      label: 'Kontrollierte Bäume',
      roles: ['kontrolle', 'bauhof'],
      filters: { baum: "self.stage == 'kontrolliert'" },
      conditions: 1,
    },
    { key: 'leer', label: 'Nur Kontrolle', roles: ['kontrolle'], filters: {}, conditions: 0 },
  ],
  config: CONFIG,
};

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const fakeApi = (over: Partial<Record<keyof SettingsApi, unknown>> = {}) =>
  ({
    saveBranding: vi.fn(() => ok(DATA)),
    saveMap: vi.fn(() => ok(DATA)),
    uploadIcon: vi.fn(),
    saveStartup: vi.fn(() => ok(DATA)),
    saveToolStart: vi.fn(() => ok(DATA)),
    savePreset: vi.fn(() => ok(DATA)),
    deletePreset: vi.fn(() => ok(DATA)),
    loadFilters: vi.fn(() => ok(FILTERS)),
    ...over,
  }) as unknown as SettingsApi & Record<keyof SettingsApi, ReturnType<typeof vi.fn>>;

function mount(current: string, api = fakeApi(), data: SettingsPageData = DATA) {
  const reload = vi.fn(() => Promise.resolve());
  render(SettingsPage, {
    data,
    locale: 'de',
    project: 'musterstadt',
    api,
    reload,
    current,
    onselect: vi.fn(),
  });
  return { api, reload };
}

describe('the shell lists the three sections where v3 had them', () => {
  it('Erststart under Allgemein, Filter & Felder and Cluster under Funktionen, with v3 status dots', () => {
    mount('startup');
    const nav = screen.getByTestId('settings-sidebar');
    for (const name of ['Erststart', 'Filter & Felder', 'Cluster'])
      expect(within(nav).getByText(name)).toBeTruthy();
    expect(nav.textContent).toContain('Funktionen');
    const dot = (label: string) =>
      within(nav).getByText(label).closest('button')?.querySelector('[data-status]');
    expect(dot('Filter & Felder')?.getAttribute('data-status')).toBe('on'); // a role has it active
    expect(dot('Cluster')?.getAttribute('data-status')).toBe('off'); // offered only
  });
});

describe('Erststart (v3 StartupSection)', () => {
  it('shows the base layers as radios with "(erste Basisebene)" first, and the overlays as checkboxes', () => {
    mount('startup');
    const base = screen.getByTestId('startup-base');
    const radios = within(base).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.parentElement?.textContent?.trim())).toEqual([
      '(erste Basisebene)',
      'Straßenkarte',
      'Luftbild',
    ]);
    expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
    const boxes = within(screen.getByTestId('startup-overlays')).getAllByRole(
      'checkbox',
    ) as HTMLInputElement[];
    expect(boxes.map((b) => [b.parentElement?.textContent?.trim(), b.checked])).toEqual([
      ['Flurkarte', true],
      ['Lärmkarte', false],
    ]);
  });

  it('saves the chosen base and overlays into the draft, tells the shell and reloads', async () => {
    const { api, reload } = mount('startup');
    const before = draftStatus.changes;
    await userEvent.click(screen.getByLabelText('Straßenkarte'));
    await userEvent.click(screen.getByLabelText('Flurkarte'));
    await userEvent.click(screen.getByLabelText('Lärmkarte'));
    await userEvent.click(screen.getByRole('button', { name: 'Startstellungen speichern' }));
    await waitFor(() =>
      expect(api.saveStartup).toHaveBeenCalledWith({ base: 'osm', overlays: ['laerm'], types: {} }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Startstellungen gespeichert'));
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('"(erste Basisebene)" sends base null', async () => {
    const { api } = mount('startup');
    await userEvent.click(screen.getByLabelText('(erste Basisebene)'));
    await userEvent.click(screen.getByRole('button', { name: 'Startstellungen speichern' }));
    await waitFor(() =>
      expect(api.saveStartup).toHaveBeenCalledWith({ base: null, overlays: ['flur'], types: {} }),
    );
  });

  it('says so when there are no overlay layers, and shows the refusal of a failed save', async () => {
    const api = fakeApi({
      saveStartup: vi.fn(() => Promise.resolve({ ok: false, message: 'Entwurf geändert' })),
    });
    mount('startup', api, { ...DATA, startup: { layers: [], types: [] } });
    expect(screen.getByText('Keine Overlay-Ebenen vorhanden.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Startstellungen speichern' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Entwurf geändert'));
  });
});

describe('Cluster (v3 ClusterSection)', () => {
  it('shows the "Beim Start aktiv" row off, and one switch per role with what each role has', () => {
    mount('cluster');
    expect(screen.getByText('Beim Start aktiv')).toBeTruthy();
    expect(
      (screen.getByRole('switch', { name: 'Alle Rollen' }) as HTMLElement).getAttribute('aria-checked'),
    ).toBe('false');
    const row = (key: string) =>
      screen.getByTestId('tool-start-cluster').querySelector(`[data-role="${key}"]`);
    expect(row('kontrolle')?.textContent).toContain('Angeboten, beim Start aus');
    expect(row('bauhof')?.textContent).toContain('Angeboten, beim Start aus');
  });

  it('one switch for all roles writes every role (v3 single control) and tells the shell', async () => {
    const { api, reload } = mount('cluster');
    const before = draftStatus.changes;
    await userEvent.click(screen.getByRole('switch', { name: 'Alle Rollen' }));
    await waitFor(() => expect(api.saveToolStart).toHaveBeenCalledWith('cluster', null, true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Startstellung gespeichert'));
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('the per-role switch writes only that role', async () => {
    const { api } = mount('cluster');
    await userEvent.click(screen.getByRole('switch', { name: 'Bauhof' }));
    await waitFor(() => expect(api.saveToolStart).toHaveBeenCalledWith('cluster', ['bauhof'], true));
  });

  it('puts the switch back and shows why when the save fails', async () => {
    const api = fakeApi({ saveToolStart: vi.fn(() => Promise.resolve({ ok: false, message: 'Abgelehnt' })) });
    mount('cluster', api);
    const all = screen.getByRole('switch', { name: 'Alle Rollen' });
    await userEvent.click(all);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Abgelehnt'));
    await waitFor(() => expect(all.getAttribute('aria-checked')).toBe('false'));
  });

  it('a role that does not have the tool carries the "Nicht angeboten" badge (v3 "Bald")', () => {
    mount('cluster', fakeApi(), { ...DATA, cluster: toolView(['active', 'none']) });
    expect(screen.getByRole('switch', { name: 'Alle Rollen' }).getAttribute('aria-checked')).toBe('false');
    const bauhof = screen.getByTestId('tool-start-cluster').querySelector('[data-role="bauhof"]');
    expect(bauhof?.textContent).toContain('Nicht angeboten');
  });

  it('shows the switch on when every role starts with it', () => {
    mount('cluster', fakeApi(), { ...DATA, cluster: toolView(['active', 'active']) });
    expect(screen.getByRole('switch', { name: 'Alle Rollen' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('Filter & Felder (v3 FieldFiltersSection)', () => {
  it('the "Beim Start aktiv" row writes the Ansichten tool for every role', async () => {
    const { api } = mount('field-filters');
    await userEvent.click(screen.getByRole('switch', { name: 'Alle Rollen' }));
    await waitFor(() => expect(api.saveToolStart).toHaveBeenCalledWith('field_filters', null, true));
  });

  it('lists the presets with name, condition count and roles, once the section has loaded them', async () => {
    mount('field-filters');
    expect(screen.getByTestId('presets-loading')).toBeTruthy();
    const list = await screen.findByTestId('preset-list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Kontrollierte Bäume');
    expect(rows[0]?.textContent).toContain('1 Bedingung(en)');
    expect(rows[0]?.textContent).toContain('Alle Rollen');
    expect(rows[1]?.textContent).toContain('0 Bedingung(en)');
    expect(rows[1]?.textContent).toContain('Rollen: Baumkontrolle');
  });

  it('shows the dashed empty box without presets', async () => {
    mount('field-filters', fakeApi({ loadFilters: vi.fn(() => ok({ ...FILTERS, presets: [] })) }));
    expect(await screen.findByText('Noch keine Presets.')).toBeTruthy();
  });

  it('says why the builder is not available when the draft has problems, and offers no "Neu"', async () => {
    const api = fakeApi({
      loadFilters: vi.fn(() => Promise.resolve({ ok: false, message: 'Entwurf hat Probleme' })),
    });
    mount('field-filters', api);
    expect(await screen.findByText('Entwurf hat Probleme')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Neu' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Neu" opens the dialog with every role ticked; a preset needs a name', async () => {
    const { api } = mount('field-filters');
    await screen.findByTestId('preset-list');
    await userEvent.click(screen.getByRole('button', { name: 'Neu' }));
    const dialog = await screen.findByTestId('preset-dialog');
    expect(within(dialog).getByRole('heading', { name: 'Neues Preset' })).toBeTruthy();
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.filter((b) => b.closest('fieldset')).every((b) => b.checked)).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Name fehlt')).toBeTruthy();
    expect(api.savePreset).not.toHaveBeenCalled();
  });

  it('saves a new preset for the chosen roles, reloads the list and tells the shell', async () => {
    const { api, reload } = mount('field-filters');
    await screen.findByTestId('preset-list');
    const before = draftStatus.changes;
    await userEvent.click(screen.getByRole('button', { name: 'Neu' }));
    const dialog = await screen.findByTestId('preset-dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Neue Meldungen');
    await userEvent.click(within(dialog).getByLabelText('Bauhof'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.savePreset).toHaveBeenCalledWith({
        name: 'Neue Meldungen',
        roles: ['kontrolle'],
        filters: {},
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Presets gespeichert'));
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
    expect(api.loadFilters).toHaveBeenCalledTimes(2);
  });

  it('edit opens the dialog with the preset (name, roles, its rows) and saves under the same key', async () => {
    const { api } = mount('field-filters');
    await screen.findByTestId('preset-list');
    await userEvent.click(screen.getByRole('button', { name: 'Preset Kontrollierte Bäume bearbeiten' }));
    const dialog = await screen.findByTestId('preset-dialog');
    expect(within(dialog).getByRole('heading', { name: 'Preset bearbeiten' })).toBeTruthy();
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Kontrollierte Bäume');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.savePreset).toHaveBeenCalled());
    expect(api.savePreset.mock.calls[0]?.[0]).toMatchObject({
      name: 'Kontrollierte Bäume',
      roles: ['kontrolle', 'bauhof'],
      key: 'kontrolliert',
      was: ['kontrolle', 'bauhof'],
      // the builder read the stored rule into a Stufe row and wrote it back in core's own form
      filters: { baum: "(self.stage == 'kontrolliert')" },
    });
  });

  it('shows the refusal of a failed save inside the dialog and keeps it open', async () => {
    const api = fakeApi({ savePreset: vi.fn(() => Promise.resolve({ ok: false, message: 'Abgelehnt' })) });
    mount('field-filters', api);
    await screen.findByTestId('preset-list');
    await userEvent.click(screen.getByRole('button', { name: 'Neu' }));
    const dialog = await screen.findByTestId('preset-dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Abgelehnt')).toBeTruthy();
    expect(screen.queryByTestId('preset-dialog')).toBeTruthy();
  });

  it('delete asks first, then removes the preset from all its roles', async () => {
    const { api } = mount('field-filters');
    await screen.findByTestId('preset-list');
    await userEvent.click(screen.getByRole('button', { name: 'Preset Kontrollierte Bäume löschen' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Preset löschen?');
    expect(api.deletePreset).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Löschen' }));
    await waitFor(() =>
      expect(api.deletePreset).toHaveBeenCalledWith({ key: 'kontrolliert', roles: ['kontrolle', 'bauhof'] }),
    );
  });
});
