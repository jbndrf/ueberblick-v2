// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import { toast } from 'svelte-sonner';
import { draftStatus } from '../draft/status-store.svelte';
import SettingsPage from './SettingsPage.svelte';
import type { SettingsApi } from './api';
import type { SettingsPageData } from './types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SHA = 'ab'.repeat(32);
const DATA: SettingsPageData = {
  projectName: 'Musterstadt',
  branding: { name: '', icon: null },
  map: { lat: 51.1657, lng: 10.4515, zoom: 10, minZoom: 1, maxZoom: 19, saved: false },
  chat: { enabled: false, all: false, roles: [], options: [] },
  layers: { layers: [], roles: [] },
  infoPages: [],
  packs: [],
  packLayers: [],
  roles: [],
  mapConfig: null,
  template: { key: 't', label: 'T', version: '1.0.0', inputs: [] },
  lifecycle: { version: 1, neverPublished: false, dirty: false, types: [], other: [], blockerCount: 0 },
  startup: { layers: [], types: [] },
  cluster: { declared: false, roles: [] },
  fieldFilters: { declared: false, roles: [] },
};
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const fakeApi = (over: Partial<Record<keyof SettingsApi, unknown>> = {}) =>
  ({
    saveBranding: vi.fn(() => ok(DATA)),
    saveMap: vi.fn(() => ok(DATA)),
    saveChat: vi.fn(() => ok(DATA)),
    saveLayers: vi.fn(() => ok(DATA)),
    uploadIcon: vi.fn(() => ok({ sha256: SHA, bytes: 3, mime: 'image/png' })),
    saveInfoPage: vi.fn(() => ok(DATA)),
    deleteInfoPage: vi.fn(() => ok(DATA)),
    savePack: vi.fn(() => ok(DATA)),
    savePackRoles: vi.fn(() => ok(DATA)),
    deletePack: vi.fn(() => ok(DATA)),
    packStatuses: vi.fn(() => ok([])),
    rebuildPack: vi.fn(() => ok({})),
    ...over,
  }) as unknown as SettingsApi & Record<keyof SettingsApi, ReturnType<typeof vi.fn>>;

function mount(
  opts: { current?: string | null; data?: SettingsPageData; api?: ReturnType<typeof fakeApi> } = {},
) {
  const api = opts.api ?? fakeApi();
  const onselect = vi.fn();
  const reload = vi.fn(() => Promise.resolve());
  render(SettingsPage, {
    data: opts.data ?? DATA,
    locale: 'de',
    project: 'musterstadt',
    api,
    reload,
    current: opts.current ?? null,
    onselect,
  });
  return { api, onselect, reload };
}

describe('the shell (v3 settings/+page.svelte, SettingsSidebar.svelte)', () => {
  it('shows the heading, the groups that have a section, and Branding as the default section', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Projekteinstellungen' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Einstellungsbereiche' });
    expect(nav.textContent).toContain('Allgemein');
    expect(nav.textContent).toContain('Karte');
    expect(nav.textContent).toContain('Funktionen');
    expect(nav.textContent).toContain('Integrationen');
    expect(nav.textContent).toContain('Gefahrenzone');
    expect(screen.getByRole('button', { name: 'Branding' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 2, name: 'App-Branding' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/noch nicht portiert/i);
  });

  it('shows the section the URL names, and the default for an unknown one', () => {
    mount({ current: 'map-defaults' });
    expect(screen.getByRole('heading', { level: 2, name: 'Standard-Kartenansicht' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Standardansicht' }).getAttribute('aria-current')).toBe('page');
    cleanup();
    mount({ current: 'gibt-es-nicht' });
    expect(screen.getByRole('heading', { level: 2, name: 'App-Branding' })).toBeTruthy();
  });

  it('asks the route to switch when a sidebar item is clicked', async () => {
    const { onselect } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Standardansicht' }));
    expect(onselect).toHaveBeenCalledWith('map-defaults');
  });

  it('lays out as a column on a phone and side by side from md (the classes v3 used)', () => {
    mount();
    const nav = screen.getByTestId('settings-sidebar');
    expect(nav.className).toContain('md:w-56');
    expect(nav.closest('aside')?.parentElement?.className).toContain('flex-col');
    expect(nav.closest('aside')?.parentElement?.className).toContain('md:flex-row');
  });
});

/** jsdom has no setter for `files` (userEvent.upload trips over the kit's `bind:files`); a change event with files does. */
const choose = (file: File) =>
  fireEvent.change(screen.getByLabelText('Bilddatei für das Symbol'), { target: { files: [file] } });

describe('Branding', () => {
  it('shows a placeholder without an icon, the project name in the field, and no remove button', () => {
    mount();
    expect(screen.getByTestId('icon-placeholder')).toBeTruthy();
    expect((screen.getByLabelText('App-Name') as HTMLInputElement).placeholder).toBe('Musterstadt');
    expect(screen.queryByRole('button', { name: 'Symbol entfernen' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Symbol hochladen' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('saves the Anzeigename into the draft and tells the shell', async () => {
    const { api, reload } = mount({ data: { ...DATA, branding: { name: 'Alt', icon: null } } });
    const before = draftStatus.changes;
    const field = screen.getByLabelText('App-Name') as HTMLInputElement;
    expect(field.value).toBe('Alt');
    await userEvent.clear(field);
    await userEvent.type(field, 'Stadt-App');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.saveBranding).toHaveBeenCalledWith({ name: 'Stadt-App' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('App-Name gespeichert'));
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('shows the refusal of a failed name save', async () => {
    const api = fakeApi({
      saveBranding: vi.fn(() => Promise.resolve({ ok: false, message: 'Entwurf geändert' })),
    });
    mount({ api });
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Entwurf geändert'));
  });

  it('previews a chosen file, uploads it, and stores its sha as the icon', async () => {
    const { api, reload } = mount();
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    await choose(file);
    await waitFor(() => expect(screen.getByAltText('Symbolvorschau')).toBeTruthy());
    const upload = screen.getByRole('button', { name: 'Symbol hochladen' }) as HTMLButtonElement;
    await waitFor(() => expect(upload.disabled).toBe(false));
    await userEvent.click(upload);
    await waitFor(() => expect(api.uploadIcon).toHaveBeenCalledWith(file));
    await waitFor(() => expect(api.saveBranding).toHaveBeenCalledWith({ icon: SHA }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Symbol hochgeladen'));
    expect(reload).toHaveBeenCalled();
  });

  it('does not store an icon when the upload is refused, and says why', async () => {
    const api = fakeApi({
      uploadIcon: vi.fn(() => Promise.resolve({ ok: false, message: 'Die Datei ist zu groß' })),
    });
    mount({ api });
    await choose(new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Symbol hochladen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Die Datei ist zu groß'));
    expect(api.saveBranding).not.toHaveBeenCalled();
  });

  it('shows the current icon and removes it', async () => {
    const { api } = mount({ data: { ...DATA, branding: { name: '', icon: SHA } } });
    const img = screen.getByAltText('Projektsymbol') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/p/musterstadt/blobs/${SHA}`);
    await userEvent.click(screen.getByRole('button', { name: 'Symbol entfernen' }));
    await waitFor(() => expect(api.saveBranding).toHaveBeenCalledWith({ icon: null }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Symbol entfernt'));
  });
});

describe('Standardansicht', () => {
  const open = (api = fakeApi()) => mount({ current: 'map-defaults', api });

  it('shows the summary box and the five fields with v3 defaults', () => {
    open();
    expect(screen.getByTestId('map-summary').textContent).toMatch(
      /Zoom\s+10,\s+Zentrum\s+51\.1657,\s+10\.4515/,
    );
    expect((screen.getByLabelText('Standard-Zoom') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Min. Zoom') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Max. Zoom') as HTMLInputElement).value).toBe('19');
    expect((screen.getByLabelText('Zentrum Breitengrad') as HTMLInputElement).value).toBe('51.1657');
    expect((screen.getByLabelText('Zentrum Längengrad') as HTMLInputElement).value).toBe('10.4515');
  });

  it('saves the values, tells the shell and reloads', async () => {
    const { api, reload } = open();
    const before = draftStatus.changes;
    await fireEvent.input(screen.getByLabelText('Standard-Zoom'), { target: { value: '12' } });
    await fireEvent.input(screen.getByLabelText('Zentrum Breitengrad'), { target: { value: '50.7' } });
    await userEvent.click(screen.getByRole('button', { name: 'Standards speichern' }));
    await waitFor(() =>
      expect(api.saveMap).toHaveBeenCalledWith({
        lat: 50.7,
        lng: 10.4515,
        zoom: 12,
        minZoom: 1,
        maxZoom: 19,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Kartenstandards gespeichert'));
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('shows v3 validation under the field and does not send: out of range, min above max, zoom outside', async () => {
    const { api } = open();
    await fireEvent.input(screen.getByLabelText('Zentrum Breitengrad'), { target: { value: '95' } });
    await userEvent.click(screen.getByRole('button', { name: 'Standards speichern' }));
    expect(await screen.findByText('Breitengrad zwischen -90 und 90')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Zentrum Breitengrad'), { target: { value: '50' } });
    await fireEvent.input(screen.getByLabelText('Min. Zoom'), { target: { value: '15' } });
    await fireEvent.input(screen.getByLabelText('Max. Zoom'), { target: { value: '5' } });
    await userEvent.click(screen.getByRole('button', { name: 'Standards speichern' }));
    expect(await screen.findByText('Min. Zoom darf nicht über Max. Zoom liegen')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Min. Zoom'), { target: { value: '12' } });
    await fireEvent.input(screen.getByLabelText('Max. Zoom'), { target: { value: '19' } });
    await fireEvent.input(screen.getByLabelText('Standard-Zoom'), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Standards speichern' }));
    expect(await screen.findByText('Standard-Zoom liegt unter Min. Zoom')).toBeTruthy();
    expect(api.saveMap).not.toHaveBeenCalled();
  });

  it('an empty field is refused, not saved as zero', async () => {
    const { api } = open();
    await fireEvent.input(screen.getByLabelText('Zentrum Längengrad'), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: 'Standards speichern' }));
    expect(await screen.findByText('Bitte eine Zahl eingeben')).toBeTruthy();
    expect(api.saveMap).not.toHaveBeenCalled();
  });
});
