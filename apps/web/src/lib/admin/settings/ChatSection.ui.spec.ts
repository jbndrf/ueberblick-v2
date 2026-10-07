// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import { toast } from 'svelte-sonner';
import { draftStatus } from '../draft/status-store.svelte';
import SettingsPage from './SettingsPage.svelte';
import type { SettingsApi } from './api';
import type { ChatView, SettingsPageData } from './types';

// WP-391: v3 `ChatSection.svelte` (switch 'Projekt-Chat aktivieren', role select 'Im Chat zugelassene Rollen', Speichern).
vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const OPTIONS = [
  { key: 'melder', label: 'Melder', description: 'Meldet Mängel' },
  { key: 'sachbearbeiter', label: 'Sachbearbeitung' },
];
const chat = (over: Partial<ChatView> = {}): ChatView => ({
  enabled: false,
  all: true,
  roles: [],
  options: OPTIONS,
  ...over,
});
const data = (c: ChatView): SettingsPageData => ({
  projectName: 'M',
  branding: { name: '', icon: null },
  map: { lat: 1, lng: 2, zoom: 10, minZoom: 1, maxZoom: 19, saved: false },
  chat: c,
  layers: { layers: [], roles: [] },
  startup: { layers: [], types: [] },
  cluster: { declared: false, roles: [] },
  fieldFilters: { declared: false, roles: [] },
  infoPages: [],
  packs: [],
  packLayers: [],
  roles: [],
  mapConfig: null,
  template: { key: 't', label: 'T', version: '1.0.0', inputs: [] },
  lifecycle: { version: 1, neverPublished: false, dirty: false, types: [], other: [], blockerCount: 0 },
});
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

function mount(c: ChatView, saveChat = vi.fn(() => ok(data(c)))) {
  const reload = vi.fn(() => Promise.resolve());
  const api = { saveChat } as unknown as SettingsApi;
  render(SettingsPage, {
    data: data(c),
    locale: 'de',
    project: 'm',
    api,
    reload,
    current: 'chat',
    onselect: vi.fn(),
  });
  return { saveChat, reload };
}

describe('Chat section (v3 ChatSection)', () => {
  it('is in the group Funktionen with a status dot, and shows v3 title, description, switch and hint', () => {
    mount(chat());
    expect(screen.getByRole('heading', { level: 2, name: 'Projekt-Chat' })).toBeTruthy();
    expect(screen.getByText(/Aktiviere einen projektweiten Chat/)).toBeTruthy();
    expect(screen.getByText('Projekt-Chat aktivieren')).toBeTruthy();
    expect(screen.getByText(/Wenn deaktiviert, ist der Chat für alle/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation').textContent).toContain('Funktionen');
  });

  it('hides the role select while the chat is off, shows it with v3 placeholder and hint once on', async () => {
    mount(chat());
    expect(screen.queryByText('Im Chat zugelassene Rollen')).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Projekt-Chat aktivieren' }));
    expect(screen.getByText('Im Chat zugelassene Rollen')).toBeTruthy();
    expect(screen.getByText('Leer = alle im Projekt')).toBeTruthy();
    expect(screen.getByText(/Leere Liste = offen für alle Teilnehmer:innen/)).toBeTruthy();
  });

  it('saves the switch alone: on with an empty selection (alle), tells the shell and reloads', async () => {
    const { saveChat, reload } = mount(chat());
    const before = draftStatus.changes;
    await userEvent.click(screen.getByRole('switch', { name: 'Projekt-Chat aktivieren' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(saveChat).toHaveBeenCalledWith({ enabled: true, roles: [] }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Chat-Einstellungen gespeichert'));
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('restricts to the picked roles (options come with their description)', async () => {
    const { saveChat } = mount(chat({ enabled: true }));
    await userEvent.click(screen.getByText('Leer = alle im Projekt'));
    expect(screen.getByText('Meldet Mängel')).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: /Melder/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(saveChat).toHaveBeenCalledWith({ enabled: true, roles: ['melder'] }));
  });

  it('shows the roles that have the chat as picked, and switching off sends enabled: false', async () => {
    const { saveChat } = mount(chat({ enabled: true, all: false, roles: ['sachbearbeiter'] }));
    expect(screen.getByText('Sachbearbeitung')).toBeTruthy();
    await userEvent.click(screen.getByRole('switch', { name: 'Projekt-Chat aktivieren' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(saveChat).toHaveBeenCalledWith({ enabled: false, roles: ['sachbearbeiter'] }));
  });

  it('shows the refusal of a failed save, and the button reads Speichern… while it works', async () => {
    let release: () => void = () => undefined;
    const saveChat = vi.fn(
      () =>
        new Promise<{ ok: false; message: string }>((resolve) => {
          release = () => resolve({ ok: false, message: 'Entwurf geändert' });
        }),
    );
    mount(chat(), saveChat as never);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(screen.getByRole('button', { name: 'Speichern…' }).hasAttribute('disabled')).toBe(true);
    release();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Entwurf geändert'));
  });

  it('the status dot follows the switch of the saved data', () => {
    mount(chat({ enabled: true }));
    expect(screen.getByTestId('settings-sidebar').querySelector('[data-status="on"]')).toBeTruthy();
  });
});
