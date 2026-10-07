// @vitest-environment jsdom
// WP-384 (S3-8): the ⋮ menu's ZIP, CSV and GeoPackage exports and the ZIP import dialog (v3 +page.svelte:193-426).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import type * as Client from './archive-client';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ueberblick/ui/components/ui/sonner', () => ({ toast }));
const upload = vi.fn();
const poll = vi.fn();
vi.mock('./archive-client', async (original) => ({
  ...(await original<typeof Client>()),
  uploadArchive: (...args: unknown[]) => upload(...args),
  pollImport: (...args: unknown[]) => poll(...args),
  saveBlob: vi.fn(),
}));
const { saveBlob } = await import('./archive-client');
const { default: ProjectCards } = await import('./ProjectCards.svelte');

beforeEach(() => {
  upload.mockReset();
  poll.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

const P = (published: boolean) => ({
  id: 'id-1',
  key: 'baeume',
  name: 'Bäume',
  description: '',
  createdAt: '2026-10-01T08:00:00Z',
  published,
});
const found = (role: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[role=${role}]`)];
const overlay = (role: string, name: string): Promise<HTMLElement> =>
  waitFor(() => {
    const hit = found(role).find((e) =>
      role === 'dialog'
        ? e.querySelector('[data-slot=dialog-title]')?.textContent?.trim() === name
        : e.textContent?.trim() === name,
    );
    if (!hit) throw new Error(`no ${role} ${name}`);
    return hit;
  });

describe.each([
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
])('exports and ZIP import at %s', (_n, width) => {
  const user = () => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    return userEvent.setup();
  };

  it.each([
    ['Gesamtes Projekt exportieren (ZIP)', '/api/admin/p/baeume/export/zip', 'Projektarchiv exportiert'],
    ['Daten exportieren (CSV)', '/api/admin/p/baeume/export/csv', 'CSV-Daten exportiert'],
    ['GeoPackage exportieren', '/api/admin/p/baeume/export/gpkg', 'GeoPackage exportiert'],
  ])('"%s" fetches %s, saves the file under the server\'s name and says so', async (item, url, said) => {
    const u = user();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('bytes', { headers: { 'content-disposition': 'attachment; filename="baeume.zip"' } }),
      );
    render(ProjectCards, { locale: 'de', projects: [P(true)] });
    await u.click(screen.getByRole('button', { name: 'Aktionen für Bäume' }));
    await u.click(await overlay('menuitem', item));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(expect.anything(), 'baeume.zip'));
    expect(fetcher).toHaveBeenCalledWith(url);
    expect(toast.success.mock.calls[0]?.[0]).toBe(said);
  });

  it.each([
    ['de', 'Enthält die Zugangsdaten der Teilnehmenden, vertraulich aufbewahren.'],
    ['en', "Contains the participants' login credentials, keep it confidential."],
  ] as const)(
    'the project ZIP says in %s that it holds login credentials: on the menu item and in the toast (A-046)',
    async (locale, note) => {
      const u = user();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('bytes', { headers: { 'content-disposition': 'attachment; filename="baeume.zip"' } }),
      );
      render(ProjectCards, { locale, projects: [P(true)] });
      await u.click(
        screen.getByRole('button', { name: locale === 'de' ? 'Aktionen für Bäume' : 'Actions for Bäume' }),
      );
      const item = await overlay(
        'menuitem',
        locale === 'de' ? 'Gesamtes Projekt exportieren (ZIP)' : 'Export full project (ZIP)',
      );
      expect(item.getAttribute('title')).toBe(note);
      await u.click(item);
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(toast.success.mock.calls[0]?.[1]).toEqual({ description: note });
    },
  );

  it('the other exports carry no such note', async () => {
    const u = user();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bytes'));
    render(ProjectCards, { locale: 'de', projects: [P(true)] });
    await u.click(screen.getByRole('button', { name: 'Aktionen für Bäume' }));
    await u.click(await overlay('menuitem', 'Daten exportieren (CSV)'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0]).toEqual(['CSV-Daten exportiert']);
  });

  it('a refused export says so and saves nothing', async () => {
    const u = user();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));
    render(ProjectCards, { locale: 'de', projects: [P(true)] });
    await u.click(screen.getByRole('button', { name: 'Aktionen für Bäume' }));
    await u.click(await overlay('menuitem', 'Daten exportieren (CSV)'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('CSV-Daten konnten nicht exportiert werden'),
    );
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it('CSV and GeoPackage wait for the first publish, the ZIP does not', async () => {
    const u = user();
    render(ProjectCards, { locale: 'de', projects: [P(false)] });
    await u.click(screen.getByRole('button', { name: 'Aktionen für Bäume' }));
    expect((await overlay('menuitem', 'Daten exportieren (CSV)')).getAttribute('aria-disabled')).toBe('true');
    expect((await overlay('menuitem', 'GeoPackage exportieren')).getAttribute('aria-disabled')).toBe('true');
    expect(
      (await overlay('menuitem', 'Gesamtes Projekt exportieren (ZIP)')).getAttribute('aria-disabled'),
    ).not.toBe('true');
  });

  it('the chevron offers "Gesamtes Projekt importieren (ZIP)"; the dialog names the file, takes a name and imports', async () => {
    const u = user();
    upload.mockResolvedValue({ ok: true, job: 'j1' });
    poll.mockImplementation(async (_job: string, onUpdate: (j: unknown) => void) => {
      onUpdate({ id: 'j1', state: 'running', done: 2, total: 4 });
      return { id: 'j1', state: 'done', done: 4, total: 4, key: 'neu' };
    });
    const reload = vi.fn(async () => undefined);
    render(ProjectCards, { locale: 'de', projects: [P(true)], reload });
    await u.click(screen.getByRole('button', { name: 'Weitere Optionen zum Erstellen' }));
    expect(await overlay('menuitem', 'Gesamtes Projekt importieren (ZIP)')).toBeTruthy();
    await u.keyboard('{Escape}');
    document.body.style.pointerEvents = '';
    await u.upload(screen.getByTestId('import-archive-file'), new File(['zip'], 'baeume.zip'));
    const dialog = await overlay('dialog', 'Gesamtes Projekt importieren (ZIP)');
    expect(within(dialog).getByTestId('archive-file').textContent).toContain('baeume.zip');
    await u.type(within(dialog).getByLabelText('Name überschreiben (optional)'), 'Kopie');
    await u.click(within(dialog).getByRole('button', { name: 'Importieren' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(upload.mock.calls[0]?.[1]).toBe('Kopie');
    expect(within(dialog).getByTestId('archive-phase').textContent).toBe('Fertig');
    expect(toast.success).toHaveBeenCalledWith('Projektarchiv importiert');
  });

  it('a failed import lists its problems and leaves no project behind', async () => {
    const u = user();
    upload.mockResolvedValue({ ok: true, job: 'j1' });
    poll.mockResolvedValue({
      id: 'j1',
      state: 'failed',
      done: 1,
      total: 4,
      problems: [{ path: 'data/baum.ndjson', message: 'nope (id)' }],
    });
    render(ProjectCards, { locale: 'de', projects: [P(true)] });
    await u.upload(screen.getByTestId('import-archive-file'), new File(['zip'], 'baeume.zip'));
    const dialog = await overlay('dialog', 'Gesamtes Projekt importieren (ZIP)');
    await u.click(within(dialog).getByRole('button', { name: 'Importieren' }));
    expect(await within(dialog).findByText('nope (id)')).toBeTruthy();
    expect(within(dialog).getByText('data/baum.ndjson')).toBeTruthy();
    expect(within(dialog).queryByText(/wurde angelegt/)).toBeNull();
    expect(within(dialog).getByTestId('archive-phase').textContent).toBe('Fehlgeschlagen');
  });

  it.each([
    ['de', 'Das Archiv ist entpackt zu groß (höchstens 4 GB).', 'Importieren'],
    ['en', 'The archive is too large once unpacked (4 GB at most).', 'Import'],
  ] as const)('a limit refusal is said in %s, by its code', async (locale, said, button) => {
    const u = user();
    upload.mockResolvedValue({ ok: true, job: 'j1' });
    poll.mockResolvedValue({
      id: 'j1',
      state: 'failed',
      done: 0,
      total: 0,
      problems: [{ path: '', message: 'The entries declare 5 bytes.', code: 'archive_too_large' }],
    });
    render(ProjectCards, { locale, projects: [P(true)] });
    await u.upload(screen.getByTestId('import-archive-file'), new File(['zip'], 'baeume.zip'));
    const title = locale === 'de' ? 'Gesamtes Projekt importieren (ZIP)' : 'Import full project (ZIP)';
    const dialog = await overlay('dialog', title);
    await u.click(within(dialog).getByRole('button', { name: button }));
    expect(await within(dialog).findByText(said)).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(said);
  });

  it.each([
    [
      'de',
      'Ein Zugangstoken kommt im Archiv mehrfach vor. Das Archiv ist beschädigt. Es wurde nichts importiert.',
      'Importieren',
    ],
    [
      'en',
      'A login token appears several times in the archive. The archive is damaged. Nothing was imported.',
      'Import',
    ],
  ] as const)('a token twice in the archive is said in %s, by its code', async (locale, said, button) => {
    const u = user();
    upload.mockResolvedValue({ ok: true, job: 'j1' });
    poll.mockResolvedValue({
      id: 'j1',
      state: 'failed',
      done: 0,
      total: 0,
      problems: [{ path: 'roster/participants.ndjson', message: 'server text', code: 'token_duplicate' }],
    });
    render(ProjectCards, { locale, projects: [P(true)] });
    await u.upload(screen.getByTestId('import-archive-file'), new File(['zip'], 'baeume.zip'));
    const title = locale === 'de' ? 'Gesamtes Projekt importieren (ZIP)' : 'Import full project (ZIP)';
    const dialog = await overlay('dialog', title);
    await u.click(within(dialog).getByRole('button', { name: button }));
    expect(await within(dialog).findByText(said)).toBeTruthy();
  });

  it.each([
    ['de', '3 Teilnehmende haben neue Zugangslinks erhalten', 'Importieren'],
    ['en', '3 participants received new login links', 'Import'],
  ] as const)(
    'an import that renewed tokens says how many, in the dialog and the toast (%s)',
    async (locale, said, button) => {
      const u = user();
      upload.mockResolvedValue({ ok: true, job: 'j1' });
      poll.mockResolvedValue({ id: 'j1', state: 'done', done: 4, total: 4, key: 'neu', renewedTokens: 3 });
      render(ProjectCards, { locale, projects: [P(true)] });
      await u.upload(screen.getByTestId('import-archive-file'), new File(['zip'], 'baeume.zip'));
      const title = locale === 'de' ? 'Gesamtes Projekt importieren (ZIP)' : 'Import full project (ZIP)';
      const dialog = await overlay('dialog', title);
      await u.click(within(dialog).getByRole('button', { name: button }));
      expect((await within(dialog).findByTestId('archive-renewed')).textContent?.trim()).toBe(said);
      expect(toast.success.mock.calls[0]?.[1]).toEqual({ description: said });
    },
  );

  it('a refused upload (too large) says so', async () => {
    const u = user();
    upload.mockResolvedValue({ ok: false, status: 413 });
    render(ProjectCards, { locale: 'de', projects: [P(true)] });
    await u.upload(screen.getByTestId('import-archive-file'), new File(['zip'], 'baeume.zip'));
    const dialog = await overlay('dialog', 'Gesamtes Projekt importieren (ZIP)');
    await u.click(within(dialog).getByRole('button', { name: 'Importieren' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toBe('Die Datei ist zu groß.');
    expect(poll).not.toHaveBeenCalled();
  });
});
