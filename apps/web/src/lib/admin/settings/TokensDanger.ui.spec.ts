// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import { toast } from 'svelte-sonner';
import SettingsPage from './SettingsPage.svelte';
import type { SettingsApi } from './api';
import type { ApiTokenRow, DeleteCounts, SettingsPageData } from './types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const DATA: SettingsPageData = {
  projectName: 'Musterstadt',
  branding: { name: '', icon: null },
  map: { lat: 51, lng: 10, zoom: 10, minZoom: 1, maxZoom: 19, saved: false },
  infoPages: [],
  packs: [],
  packLayers: [],
  roles: [],
  mapConfig: null,
  template: { key: 't', label: 'T', version: '1.0.0', inputs: [] },
  chat: { enabled: false, all: false, roles: [], options: [] },
  lifecycle: { version: 1, neverPublished: false, dirty: false, types: [], other: [], blockerCount: 0 },
  layers: { layers: [], roles: [] },
  startup: { layers: [], types: [] },
  cluster: { declared: false, roles: [] },
  fieldFilters: { declared: false, roles: [] },
};
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const fail = () => Promise.resolve({ ok: false as const, message: 'x' });
const ROW: ApiTokenRow = {
  id: 't1',
  participantId: 'anna',
  adminEmail: null,
  label: 'Laptop',
  lastFour: 'ab12',
  createdAt: '2026-05-01T08:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
};
const COUNTS: DeleteCounts = {
  types: 2,
  roles: 3,
  layers: 0,
  packs: 0,
  infoPages: 1,
  participants: 4,
  features: 120,
};

function mount(section: string, over: Partial<Record<keyof SettingsApi, unknown>> = {}) {
  const api = {
    listTokens: vi.fn(() => ok([ROW])),
    listParticipants: vi.fn(() =>
      ok([
        { id: 'anna', name: 'Anna Beispiel' },
        { id: 'ben', name: null },
      ]),
    ),
    createToken: vi.fn(() => ok({ token: 'ubk_SECRET', info: ROW })),
    revokeToken: vi.fn(() => ok(null)),
    deleteCounts: vi.fn(() => ok(COUNTS)),
    deleteProject: vi.fn(() => ok(null)),
    ...over,
  } as unknown as SettingsApi & Record<string, ReturnType<typeof vi.fn>>;
  render(SettingsPage, {
    data: DATA,
    locale: 'de',
    project: 'musterstadt',
    api,
    reload: () => Promise.resolve(),
    current: section,
    onselect: vi.fn(),
  });
  return api;
}

describe('the sidebar', () => {
  it('has GIS-Zugang under Integrationen and the destructive Projekt löschen under Gefahrenzone', () => {
    mount('api-tokens');
    const nav = screen.getByRole('navigation', { name: 'Einstellungsbereiche' });
    expect(nav.textContent).toContain('Integrationen');
    expect(nav.textContent).toContain('GIS-Zugang');
    expect(nav.textContent).toContain('Gefahrenzone');
    expect(nav.textContent).toContain('Projekt löschen');
  });
});

describe('API-Tokens (v3 ApiTokensSection)', () => {
  it('lists the tokens with the participant, the last four characters and Nie for no expiry', async () => {
    mount('api-tokens');
    const table = await screen.findByTestId('token-table');
    expect(table.textContent).toContain('Laptop');
    expect(table.textContent).toContain('…ab12');
    expect(table.textContent).toContain('Anna Beispiel (anna)');
    expect(table.textContent).toContain('Nie');
  });

  it('shows the empty text and the OGC connection URL with the three steps', async () => {
    mount('api-tokens', { listTokens: vi.fn(() => ok([])) });
    expect(await screen.findByText('Noch keine Token.')).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/api/p/musterstadt/ogc`)).toBeTruthy();
    expect(screen.getByText(/„Basic“ wählen und das Token als Benutzername/)).toBeTruthy();
  });

  it('creates a token for the chosen participant, shows the secret once and reloads the list', async () => {
    const user = userEvent.setup();
    const api = mount('api-tokens');
    await screen.findByTestId('token-table');
    const button = screen.getByRole('button', { name: 'Token erstellen' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('Teilnehmer'), 'anna');
    await user.type(screen.getByLabelText('Token-Bezeichnung'), 'Mein Laptop');
    await user.type(screen.getByLabelText('Läuft ab (optional)'), '2099-01-31');
    await user.click(button);
    expect(api.createToken).toHaveBeenCalledWith({
      participant: 'anna',
      label: 'Mein Laptop',
      expiresAt: '2099-01-31T23:59:59.000Z',
    });
    expect((await screen.findByTestId('created-token')).textContent).toContain('ubk_SECRET');
    expect(screen.getByText(/nur dieses eine Mal/)).toBeTruthy();
    expect(api.listTokens).toHaveBeenCalledTimes(2);
  });

  it('says so when the token cannot be created', async () => {
    const user = userEvent.setup();
    mount('api-tokens', { createToken: vi.fn(fail) });
    await screen.findByTestId('token-table');
    await user.selectOptions(screen.getByLabelText('Teilnehmer'), 'ben');
    await user.type(screen.getByLabelText('Token-Bezeichnung'), 'x');
    await user.click(screen.getByRole('button', { name: 'Token erstellen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Token konnte nicht erstellt werden'));
    expect(screen.queryByTestId('created-token')).toBeNull();
  });

  it('revokes after the confirmation and not without it', async () => {
    const user = userEvent.setup();
    const api = mount('api-tokens');
    await screen.findByTestId('token-table');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: /Widerrufen/ }));
    expect(api.revokeToken).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Widerrufen/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(api.revokeToken).toHaveBeenCalledWith('t1');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Token widerrufen'));
  });
});

describe('Gefahrenzone (v3 DangerZoneSection)', () => {
  it('opens the dialog, lists the counts without zeros and needs the typed project key', async () => {
    const user = userEvent.setup();
    const api = mount('danger-zone');
    await user.click(
      within(screen.getByTestId('settings-section')).getByRole('button', { name: 'Projekt löschen' }),
    );
    const counts = await screen.findByTestId('delete-counts');
    expect(api.deleteCounts).toHaveBeenCalledTimes(1);
    expect(counts.textContent).toContain('Objektarten: 2');
    expect(counts.textContent).toContain('Rollen: 3');
    expect(counts.textContent).toContain('Infoseiten: 1');
    expect(counts.textContent).not.toContain('Kartenebenen');
    expect(counts.textContent).toContain('Teilnehmende: 4 · Objekte: 120');

    const confirm = screen.getByRole('button', { name: 'Löschen' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Projektschlüssel „musterstadt“/), 'musterstadt');
    expect(confirm.disabled).toBe(false);
  });

  it('deletes with the typed key and leaves for the project list', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location);
    const api = mount('danger-zone');
    await user.click(
      within(screen.getByTestId('settings-section')).getByRole('button', { name: 'Projekt löschen' }),
    );
    await screen.findByTestId('delete-counts');
    await user.type(screen.getByLabelText(/Projektschlüssel/), 'musterstadt');
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(api.deleteProject).toHaveBeenCalledWith('musterstadt');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/admin/projects'));
    expect(toast.success).toHaveBeenCalledWith('Projekt gelöscht');
  });

  it('keeps the page and says so when the delete fails; a wrong key never calls it', async () => {
    const user = userEvent.setup();
    const api = mount('danger-zone', { deleteProject: vi.fn(fail) });
    await user.click(
      within(screen.getByTestId('settings-section')).getByRole('button', { name: 'Projekt löschen' }),
    );
    await screen.findByTestId('delete-counts');
    await user.type(screen.getByLabelText(/Projektschlüssel/), 'falsch');
    expect((screen.getByRole('button', { name: 'Löschen' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByLabelText(/Projektschlüssel/));
    await user.type(screen.getByLabelText(/Projektschlüssel/), 'musterstadt');
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Projekt konnte nicht gelöscht werden'));
    expect(api.deleteProject).toHaveBeenCalledTimes(1);
  });
});
