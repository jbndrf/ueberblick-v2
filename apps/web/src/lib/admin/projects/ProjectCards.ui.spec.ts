// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import ProjectCards from './ProjectCards.svelte';

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

const P = (over: Partial<{ key: string; name: string; description: string; createdAt: string }> = {}) => ({
  id: 'id-1',
  key: 'baumkataster_nord',
  name: 'Baumkataster Nord',
  description: 'Bäume im Norden',
  createdAt: '2026-10-01T08:00:00Z',
  ...over,
});

describe('Projekte page (v3 +page.svelte:428-585)', () => {
  it('a card shows name, description and "Projekt öffnen" to the project\'s Teilnehmende', () => {
    render(ProjectCards, { locale: 'de', projects: [P()] });
    expect(screen.getByRole('heading', { name: 'Projekte' })).toBeTruthy();
    expect(screen.getByText('Baumkataster Nord')).toBeTruthy();
    expect(screen.getByText('Bäume im Norden')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Projekt öffnen' }).getAttribute('href')).toBe(
      '/admin/projects/baumkataster_nord/participants',
    );
  });

  it('without a description the card says "Erstellt: <Datum>"', () => {
    render(ProjectCards, { locale: 'de', projects: [P({ description: '' })] });
    expect(screen.getByText('Erstellt: 1.10.2026')).toBeTruthy();
  });

  it('"Projekt erstellen" in the header leads to /admin/projects/new', () => {
    render(ProjectCards, { locale: 'de', projects: [P()] });
    expect(screen.getByRole('link', { name: 'Projekt erstellen' }).getAttribute('href')).toBe(
      '/admin/projects/new',
    );
  });

  it('the empty state is v3\'s text with a second "Projekt erstellen" button', () => {
    render(ProjectCards, { locale: 'de', projects: [] });
    expect(
      screen.getByText('Keine Projekte gefunden. Erstellen Sie Ihr erstes Projekt, um loszulegen.'),
    ).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Projekt erstellen' })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Projekt öffnen' })).toBeNull();
  });

  it('English labels', () => {
    render(ProjectCards, { locale: 'en', projects: [P()] });
    expect(screen.getByRole('link', { name: 'Open project' })).toBeTruthy();
  });
});

const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const found = (role: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[role=${role}]`)];
/** Overlays are portalled and the page behind them is aria-hidden, so look them up by role and text. */
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
])('the ⋮ menu and the split button at %s (WP-383)', (_n, width) => {
  const user = () => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    return userEvent.setup();
  };

  it('the card menu has v3\'s export items in v3\'s order, the GeoPackage item and then "Als Vorlage veröffentlichen"', async () => {
    const u = user();
    render(ProjectCards, { locale: 'de', projects: [P({ published: true } as never)] });
    await u.click(screen.getByRole('button', { name: 'Aktionen für Baumkataster Nord' }));
    const items = (
      await waitFor(() => {
        const f = found('menuitem');
        if (f.length === 0) throw new Error('none');
        return f;
      })
    ).map((i) => i.textContent?.trim());
    expect(items).toEqual([
      'Schema exportieren',
      'Gesamtes Projekt exportieren (ZIP)',
      'Daten exportieren (CSV)',
      'GeoPackage exportieren',
      'Als Vorlage veröffentlichen',
    ]);
  });

  it('"Als Vorlage veröffentlichen" is disabled until the project is published', async () => {
    const u = user();
    render(ProjectCards, { locale: 'de', projects: [P()] });
    await u.click(screen.getByRole('button', { name: 'Aktionen für Baumkataster Nord' }));
    expect((await overlay('menuitem', 'Als Vorlage veröffentlichen')).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('the chevron of the split button offers "Aus Datei importieren"; a refused file lists its problems', async () => {
    const u = user();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        reply(422, { problems: [{ path: 'extends', message: 'Die Vorlage gibt es nicht.' }] }),
      );
    render(ProjectCards, { locale: 'de', projects: [P()] });
    await u.click(screen.getByRole('button', { name: 'Weitere Optionen zum Erstellen' }));
    expect(await overlay('menuitem', 'Aus Datei importieren')).toBeTruthy();
    await u.keyboard('{Escape}');
    document.body.style.pointerEvents = '';
    await u.upload(screen.getByTestId('import-file'), new File(['x'], 'p.yaml'));
    const dialog = await overlay('dialog', 'Die Datei kann nicht importiert werden');
    expect(within(dialog).getByText('Die Vorlage gibt es nicht.')).toBeTruthy();
    expect(within(dialog).getByText('extends')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/projects/import',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('a valid file reloads the list', async () => {
    const u = user();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(201, { key: 'neu', id: 'x' }));
    const reload = vi.fn(async () => undefined);
    render(ProjectCards, { locale: 'de', projects: [P()], reload });
    await u.upload(screen.getByTestId('import-file'), new File(['x'], 'p.yaml'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('publishing as a template: the dialog starts with the project, the next version, and posts', async () => {
    const u = user();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(reply(201, { key: 'baumkataster_nord', version: '1.1.0', created: true }));
    const reload = vi.fn(async () => undefined);
    render(ProjectCards, {
      locale: 'de',
      projects: [P({ published: true } as never)],
      templates: [{ key: 'baumkataster_nord', version: '1.0.0' }],
      reload,
    });
    await u.click(screen.getByRole('button', { name: 'Aktionen für Baumkataster Nord' }));
    await u.click(await overlay('menuitem', 'Als Vorlage veröffentlichen'));
    const dialog = await overlay('dialog', 'Als Vorlage veröffentlichen');
    expect((within(dialog).getByLabelText('Version') as HTMLInputElement).value).toBe('1.1.0');
    expect((within(dialog).getByLabelText('Schlüssel') as HTMLInputElement).value).toBe('baumkataster_nord');
    expect((within(dialog).getByLabelText('Name der Vorlage') as HTMLInputElement).value).toBe(
      'Baumkataster Nord',
    );
    await u.click(within(dialog).getByRole('button', { name: 'Veröffentlichen' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body)) as Record<
      string,
      string
    >;
    expect(body).toEqual({
      project: 'baumkataster_nord',
      key: 'baumkataster_nord',
      version: '1.1.0',
      label: 'Baumkataster Nord',
    });
  });

  it('the dialog shows the server field problems and stays open', async () => {
    const u = user();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(400, { problems: [{ field: 'version', message: 'x' }] }),
    );
    render(ProjectCards, { locale: 'de', projects: [P({ published: true } as never)] });
    await u.click(screen.getByRole('button', { name: 'Aktionen für Baumkataster Nord' }));
    await u.click(await overlay('menuitem', 'Als Vorlage veröffentlichen'));
    const dialog = await overlay('dialog', 'Als Vorlage veröffentlichen');
    await u.click(within(dialog).getByRole('button', { name: 'Veröffentlichen' }));
    expect(await within(dialog).findByText('Eine Version hat die Form 1.0.0.')).toBeTruthy();
  });
});
