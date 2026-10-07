// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import SettingsPage from './SettingsPage.svelte';
import type { SettingsApi } from './api';
import type { StartType } from './start-types';
import type { SettingsPageData } from './types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DATA: SettingsPageData = {
  projectName: 'Musterstadt',
  branding: { name: '', icon: null },
  map: { lat: 51.1657, lng: 10.4515, zoom: 10, minZoom: 1, maxZoom: 19, saved: false },
  infoPages: [],
  packs: [],
  packLayers: [],
  roles: [],
  mapConfig: null,
  template: { key: 't', label: 'T', version: '1.0.0', inputs: [] },
  chat: { enabled: false, all: false, roles: [], options: [] },
  lifecycle: { version: 1, neverPublished: false, dirty: false, types: [], other: [], blockerCount: 0 },
  layers: { layers: [], roles: [] },
  startup: { layers: [{ key: 'flur', label: 'Flurkarte', kind: 'overlay', on: true }], types: [] },
  cluster: { declared: false, roles: [] },
  fieldFilters: { declared: false, roles: [] },
};
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
function mount(data: SettingsPageData = DATA) {
  const api = { saveStartup: vi.fn(() => ok(DATA)) } as unknown as SettingsApi & {
    saveStartup: ReturnType<typeof vi.fn>;
  };
  render(SettingsPage, {
    data,
    locale: 'de',
    project: 'musterstadt',
    api,
    reload: vi.fn(() => Promise.resolve()),
    current: 'startup',
    onselect: vi.fn(),
  });
  return { api };
}

// WP-397 (A-040): v3's "Sichtbare Workflows" block of Erststart, as "Sichtbare Objektarten".
describe('Erststart: Sichtbare Objektarten (v3 StartupSection :286-350)', () => {
  const TYPES: StartType[] = [
    {
      key: 'baum',
      label: 'Baum',
      on: true,
      mode: 'stage',
      values: ['erfasst', 'erledigt', 'massnahme'].map((v) => ({
        value: v,
        label: v.toUpperCase(),
        on: true,
      })),
    },
    { key: 'flaeche', label: 'Fläche', on: true, mode: 'values', values: [] },
  ];
  const FIRST = TYPES[0] as StartType;
  const SECOND = TYPES[1] as StartType;
  const withTypes = (types: readonly StartType[]): SettingsPageData => ({
    ...DATA,
    startup: { ...DATA.startup, types },
  });
  const save = () => userEvent.click(screen.getByRole('button', { name: 'Startstellungen speichern' }));
  const calledWith = (api: { saveStartup: ReturnType<typeof vi.fn> }) =>
    (api.saveStartup.mock.calls[0] as unknown as [{ types: unknown }])[0].types;

  it('lists the Objektarten after the layers, "Alle" on and the checkboxes disabled; a chevron only with values', () => {
    mount(withTypes(TYPES));
    const block = screen.getByTestId('startup-types');
    expect(block.textContent).toContain('Sichtbare Objektarten');
    expect(within(block).getByRole('switch', { name: 'Alle' }).getAttribute('aria-checked')).toBe('true');
    const boxes = within(block).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => [b.disabled, b.checked])).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(within(block).getAllByRole('button', { name: 'Werte ein- oder ausklappen' })).toHaveLength(1);
    expect(screen.getByTestId('startup-overlays').compareDocumentPosition(block)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('"Alle" off enables the checkboxes; unticking a type is saved as on: false', async () => {
    const { api } = mount(withTypes(TYPES));
    await userEvent.click(screen.getByRole('switch', { name: 'Alle' }));
    await userEvent.click(screen.getByLabelText('Fläche'));
    await save();
    await waitFor(() => expect(api.saveStartup).toHaveBeenCalled());
    expect(calledWith(api)).toEqual({
      baum: { on: true, values: null },
      flaeche: { on: false, values: null },
    });
  });

  it('expands the stage list ("Phasen, die beim Start sichtbar sind") and saves the unticked value', async () => {
    const { api } = mount(withTypes(TYPES));
    await userEvent.click(screen.getByRole('button', { name: 'Werte ein- oder ausklappen' }));
    const list = screen.getByTestId('startup-values-baum');
    expect(list.textContent).toContain('Phasen, die beim Start sichtbar sind');
    await userEvent.click(within(list).getByLabelText('ERLEDIGT'));
    await save();
    await waitFor(() => expect(api.saveStartup).toHaveBeenCalled());
    expect(calledWith(api)).toEqual({
      baum: { on: true, values: ['erfasst', 'massnahme'] },
      flaeche: { on: true, values: null },
    });
  });

  it('reads the saved state back: a type off turns "Alle" off, a value subset shows its ticks', async () => {
    const saved = [
      {
        ...FIRST,
        on: true,
        values: FIRST.values.map((v) => ({ ...v, on: v.value !== 'massnahme' })),
      },
      { ...SECOND, on: false },
    ];
    mount(withTypes(saved));
    const block = screen.getByTestId('startup-types');
    expect(within(block).getByRole('switch', { name: 'Alle' }).getAttribute('aria-checked')).toBe('false');
    expect((screen.getByLabelText('Fläche') as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Werte ein- oder ausklappen' }));
    const list = screen.getByTestId('startup-values-baum');
    expect((within(list).getAllByRole('checkbox') as HTMLInputElement[]).map((b) => b.checked)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('says "Keine Objektarten." when there are none', () => {
    mount();
    expect(screen.getByText('Keine Objektarten.')).toBeTruthy();
  });
});
