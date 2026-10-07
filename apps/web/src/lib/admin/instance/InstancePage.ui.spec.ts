// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import { toast } from 'svelte-sonner';
import InstancePage from './InstancePage.svelte';
import { createInstanceApi, type InstanceApi } from './api';
import type { InstanceSettingsView, LegalPageView } from './model';

// WP-447: v3 `admin/instance/+page.svelte` on the instance API.
vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SETTINGS: InstanceSettingsView = {
  requireConsent: false,
  consentTitle: 'Datenschutz',
  consentBody: '<p>Text</p>',
  acceptLabel: 'Annehmen',
  rejectLabel: 'Ablehnen',
};
const IMPRESSUM: LegalPageView = {
  slug: 'impressum',
  title: 'Impressum',
  body: '<p>Betreiber</p>',
  sortOrder: 2,
  showInConsentFooter: true,
};

const ok = () => Promise.resolve({ ok: true as const });
function mount(over: Partial<Record<keyof InstanceApi, ReturnType<typeof vi.fn>>> = {}, pages = [IMPRESSUM]) {
  const api = {
    saveSettings: vi.fn(ok),
    createPage: vi.fn(ok),
    updatePage: vi.fn(ok),
    deletePage: vi.fn(ok),
    ...over,
  };
  const reload = vi.fn(() => Promise.resolve());
  render(InstancePage, {
    settings: SETTINGS,
    pages,
    locale: 'de',
    api: api as unknown as InstanceApi,
    reload,
  });
  return { api, reload, user: userEvent.setup() };
}

describe('consent card (v3 :61-162)', () => {
  it('shows the current settings, v3 labels and the hint', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Instanz-Einstellungen' })).toBeTruthy();
    expect(screen.getByText('Cookie-Consent-Banner')).toBeTruthy();
    expect(screen.getByText(/Wenn deaktiviert, wird die Login-Seite direkt angezeigt/)).toBeTruthy();
    expect((screen.getByLabelText('Banner-Überschrift') as HTMLInputElement).value).toBe('Datenschutz');
    expect((screen.getByLabelText('Banner-Text (HTML erlaubt)') as HTMLTextAreaElement).value).toBe(
      '<p>Text</p>',
    );
    expect((screen.getByLabelText('Beschriftung Annehmen-Button') as HTMLInputElement).value).toBe(
      'Annehmen',
    );
    expect(
      screen
        .getByRole('checkbox', { name: 'Cookie-Zustimmung vor Login erforderlich' })
        .getAttribute('data-state'),
    ).toBe('unchecked');
  });

  it('saves the edited settings through the API, toasts, and reloads', async () => {
    const { api, reload, user } = mount();
    await user.click(screen.getByRole('checkbox', { name: 'Cookie-Zustimmung vor Login erforderlich' }));
    const title = screen.getByLabelText('Banner-Überschrift');
    await user.clear(title);
    await user.type(title, 'Neu');
    await user.clear(screen.getByLabelText('Beschriftung Ablehnen-Button'));
    await user.click(within(screen.getByTestId('consent-card')).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
    expect(api.saveSettings).toHaveBeenCalledWith({
      requireConsent: true,
      consentTitle: 'Neu',
      consentBody: '<p>Text</p>',
      acceptLabel: 'Annehmen',
      rejectLabel: 'Reject', // v3: an empty label falls back
    });
    expect(toast.success).toHaveBeenCalledWith('Gespeichert.');
    expect(reload).toHaveBeenCalled();
  });

  it('a failed save toasts v3 "Speichern fehlgeschlagen." and does not reload', async () => {
    const { reload, user } = mount({
      saveSettings: vi.fn(() => Promise.resolve({ ok: false, refused: false })),
    });
    await user.click(within(screen.getByTestId('consent-card')).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Speichern fehlgeschlagen.'));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('legal pages (v3 :165-295)', () => {
  it('lists each page with its public link, fields, footer switch and the add card', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Rechtsseiten' })).toBeTruthy();
    const card = screen.getByTestId('legal-page');
    const link = within(card).getByRole('link', { name: '/legal/impressum' });
    expect(link.getAttribute('href')).toBe('/legal/impressum');
    expect(link.getAttribute('target')).toBe('_blank');
    expect((within(card).getByLabelText('Titel') as HTMLInputElement).value).toBe('Impressum');
    expect((within(card).getByLabelText('Slug (URL)') as HTMLInputElement).value).toBe('impressum');
    expect((within(card).getByLabelText('Reihenfolge') as HTMLInputElement).value).toBe('2');
    expect(
      within(card).getByRole('checkbox', { name: 'Im Consent-Footer anzeigen' }).getAttribute('data-state'),
    ).toBe('checked');
    expect((within(card).getByLabelText('Inhalt (HTML erlaubt)') as HTMLTextAreaElement).value).toBe(
      '<p>Betreiber</p>',
    );
    expect(screen.getByTestId('new-page-card')).toBeTruthy();
  });

  it('with no page only the add card is there (v3 has no empty state)', () => {
    mount({}, []);
    expect(screen.queryByTestId('legal-page')).toBeNull();
    expect(screen.getByText('Rechtsseite hinzufügen')).toBeTruthy();
  });

  it('edits a page: order, footer and a new slug go to updatePage(oldSlug, …)', async () => {
    const { api, reload, user } = mount();
    const card = screen.getByTestId('legal-page');
    const sort = within(card).getByLabelText('Reihenfolge');
    await user.clear(sort);
    await user.type(sort, '5');
    await user.click(within(card).getByRole('checkbox', { name: 'Im Consent-Footer anzeigen' }));
    const slug = within(card).getByLabelText('Slug (URL)');
    await user.clear(slug);
    await user.type(slug, 'Legal Notice');
    await user.click(within(card).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.updatePage).toHaveBeenCalledTimes(1));
    expect(api.updatePage).toHaveBeenCalledWith('impressum', {
      title: 'Impressum',
      slug: 'legal-notice',
      body: '<p>Betreiber</p>',
      sortOrder: 5,
      showInConsentFooter: false,
    });
    expect(toast.success).toHaveBeenCalledWith('Gespeichert.');
    expect(reload).toHaveBeenCalled();
  });

  it('delete asks first: Abbrechen keeps the page', async () => {
    const { api, user } = mount();
    await user.click(within(screen.getByTestId('legal-page')).getByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Diese Seite löschen?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(api.deletePage).not.toHaveBeenCalled();
  });

  it('delete after the confirm: deletes by slug, toasts and reloads', async () => {
    const { api, reload, user } = mount();
    await user.click(within(screen.getByTestId('legal-page')).getByRole('button', { name: 'Löschen' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(api.deletePage).toHaveBeenCalledWith('impressum'));
    expect(toast.success).toHaveBeenCalledWith('Gelöscht.');
    expect(reload).toHaveBeenCalled();
  });

  it('adds a page: slug from the title when empty, footer on by default, form cleared after', async () => {
    const { api, reload, user } = mount();
    const card = screen.getByTestId('new-page-card');
    expect(
      within(card).getByRole('checkbox', { name: 'Im Consent-Footer anzeigen' }).getAttribute('data-state'),
    ).toBe('checked');
    expect(within(card).getByPlaceholderText('automatisch aus dem Titel, falls leer')).toBeTruthy();
    const title = within(card).getByLabelText('Titel') as HTMLInputElement;
    await user.type(title, 'Datenschutz Erklärung');
    await user.type(within(card).getByLabelText('Inhalt (HTML erlaubt)'), '<h1>DSE</h1>');
    await user.click(within(card).getByRole('button', { name: 'Seite anlegen' }));
    await waitFor(() => expect(api.createPage).toHaveBeenCalledTimes(1));
    expect(api.createPage).toHaveBeenCalledWith({
      title: 'Datenschutz Erklärung',
      slug: 'datenschutz-erklaerung',
      body: '<h1>DSE</h1>',
      sortOrder: 0,
      showInConsentFooter: true,
    });
    expect(toast.success).toHaveBeenCalledWith('Angelegt.');
    await waitFor(() => expect(title.value).toBe(''));
    expect(reload).toHaveBeenCalled();
  });

  it('a taken slug (409 from the create-only PUT) is refused with its message and the form keeps its text (real API)', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 409 })));
    const api = createInstanceApi({
      fetch: fetch as unknown as typeof globalThis.fetch,
      messages: { slugTaken: 'Dieser Slug ist schon vergeben.', slugInvalid: 'x' },
    });
    const user = userEvent.setup();
    render(InstancePage, { settings: SETTINGS, pages: [IMPRESSUM], locale: 'de', api, reload: vi.fn() });
    const card = screen.getByTestId('new-page-card');
    await user.type(within(card).getByLabelText('Titel'), 'Impressum');
    await user.click(within(card).getByRole('button', { name: 'Seite anlegen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Dieser Slug ist schon vergeben.'));
    expect(fetch).toHaveBeenCalledWith(
      '/api/instance/legal/impressum?create=1',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect((within(card).getByLabelText('Titel') as HTMLInputElement).value).toBe('Impressum');
  });

  it('a failed create toasts v3 "Anlegen fehlgeschlagen."', async () => {
    const { user } = mount({
      createPage: vi.fn(() => Promise.resolve({ ok: false, refused: false })),
    });
    const card = screen.getByTestId('new-page-card');
    await user.type(within(card).getByLabelText('Titel'), 'Neu');
    await user.click(within(card).getByRole('button', { name: 'Seite anlegen' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Anlegen fehlgeschlagen.'));
  });
});
