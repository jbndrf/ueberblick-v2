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
import type { SettingsPageData, TemplateView } from './types';

// WP-448: the Vorlage section (engine-new): template, version, and a form for the template's inputs.
vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ text: '', revision: 1 })));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const WITH: TemplateView = {
  key: 'baumkataster',
  label: 'Baumkataster',
  version: '1.1.0',
  inputs: [
    {
      key: 'intervall',
      type: 'integer',
      editable: true,
      label: 'Kontrollintervall (Monate)',
      value: 12,
      options: [],
    },
    { key: 'aktiv', type: 'boolean', editable: true, label: 'Erinnerung', value: false, options: [] },
    {
      key: 'bezirk',
      type: 'text',
      editable: true,
      label: 'Bezirk',
      description: 'Name des Bezirks',
      value: 'Nord',
      options: [],
    },
  ],
};
const data = (template: TemplateView): SettingsPageData =>
  ({
    projectName: 'M',
    branding: { name: '', icon: null },
    map: { lat: 1, lng: 2, zoom: 10, minZoom: 1, maxZoom: 19, saved: false },
    chat: { enabled: false, all: true, roles: [], options: [] },
    template,
    layers: { layers: [], roles: [] },
    startup: { layers: [], types: [] },
    cluster: { declared: false, roles: [] },
    fieldFilters: { declared: false, roles: [] },
    infoPages: [],
    packs: [],
    packLayers: [],
    roles: [],
    mapConfig: null,
    lifecycle: { version: 1, neverPublished: false, dirty: false, types: [], other: [], blockerCount: 0 },
  }) satisfies SettingsPageData;
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

function mount(template: TemplateView, saveTemplateInputs = vi.fn(() => ok(data(template)))) {
  const reload = vi.fn(() => Promise.resolve());
  render(SettingsPage, {
    data: data(template),
    locale: 'de',
    project: 'm',
    api: { saveTemplateInputs } as unknown as SettingsApi,
    reload,
    current: 'template',
    onselect: vi.fn(),
  });
  return { saveTemplateInputs, reload };
}

describe('Vorlage section', () => {
  it('is in the group Allgemein and shows the template and its version', () => {
    mount(WITH);
    expect(screen.getByRole('heading', { level: 2, name: 'Vorlage' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Projekt & Freigabe' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByTestId('template-summary').textContent).toContain('Baumkataster');
    expect(screen.getByTestId('template-summary').textContent).toContain('1.1.0');
  });

  it('shows template and version only when the template declares no inputs', () => {
    mount({ ...WITH, inputs: [] });
    expect(screen.getByText('Diese Vorlage bietet keine Eingaben zum Anpassen an.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
  });

  it('renders each input by type, and saves only the changed values', async () => {
    const { saveTemplateInputs, reload } = mount(WITH);
    const interval = screen.getByLabelText('Kontrollintervall (Monate)') as HTMLInputElement;
    expect(interval.type).toBe('number');
    expect(interval.value).toBe('12');
    expect(screen.getByText('Name des Bezirks')).toBeTruthy();
    const before = draftStatus.changes;
    await userEvent.clear(interval);
    await userEvent.type(interval, '6');
    await userEvent.click(screen.getByRole('switch', { name: 'Erinnerung' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(saveTemplateInputs).toHaveBeenCalledWith({ intervall: 6, aktiv: true }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Eingaben gespeichert'));
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('does not send an empty number, and shows the refusal of a failed save', async () => {
    const saveTemplateInputs = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Entwurf geändert' }),
    );
    mount(WITH, saveTemplateInputs as never);
    const interval = screen.getByLabelText('Kontrollintervall (Monate)');
    await userEvent.clear(interval);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(screen.getByText('Der Wert passt nicht zur Eingabe').getAttribute('role')).toBe('alert');
    expect(saveTemplateInputs).not.toHaveBeenCalled();
    await userEvent.type(interval, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Entwurf geändert'));
  });

  it('edits a multiselect and a localized_text input and saves them (WP-484)', async () => {
    const template: TemplateView = {
      ...WITH,
      inputs: [
        {
          key: 'farben',
          type: 'multiselect',
          editable: true,
          label: 'Farben',
          value: ['rot'],
          options: [
            { key: 'rot', label: 'Rot' },
            { key: 'blau', label: 'Blau' },
          ],
        },
        {
          key: 'hinweis',
          type: 'localized_text',
          editable: true,
          label: 'Hinweis',
          value: { de: 'Hallo' },
          options: [],
        },
      ],
    };
    const { saveTemplateInputs } = mount(template);
    expect((screen.getByLabelText('Hinweis (Deutsch)') as HTMLInputElement).value).toBe('Hallo');
    await userEvent.type(screen.getByLabelText('Hinweis (English)'), 'Hi');
    await userEvent.click(screen.getByRole('button', { name: /Farben|Rot/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Blau/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(saveTemplateInputs).toHaveBeenCalledWith({
        farben: ['rot', 'blau'],
        hinweis: { de: 'Hallo', en: 'Hi' },
      }),
    );
  });
});
