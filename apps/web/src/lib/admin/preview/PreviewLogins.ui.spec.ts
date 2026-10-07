// @vitest-environment jsdom
// WP-373: v3's "Vorschau-Logins" card (`fork/+page.svelte:297-312`) in the deploy overview: a row per role plus
// "Keine Rolle" with its link, "Link kopieren" -> "Kopiert!", and owner V1's "Demo-Daten zurücksetzen" behind a question.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import PreviewLogins from './PreviewLogins.svelte';
import type { PreviewView } from './types';

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  vi.restoreAllMocks();
});

const VIEW: PreviewView = {
  status: 'ready',
  logins: [
    {
      role: 'kontrolle',
      label: 'Kontrolle',
      participantId: 'preview-g1-r-kontrolle',
      token: 'AAAA-1',
      link: '/login?token=AAAA-1',
    },
    { role: null, label: '', participantId: 'preview-g1-none', token: 'BBBB-2', link: '/login?token=BBBB-2' },
  ],
};
const mount = (view: PreviewView | null, reset: PreviewView | null = view, locale: 'de' | 'en' = 'de') => {
  const client = { preview: vi.fn(async () => view), resetPreview: vi.fn(async () => reset) };
  render(PreviewLogins, { locale, client });
  return client;
};

describe('the logins list', () => {
  it('shows one row per role and "Keine Rolle" with the full link, in German and English', async () => {
    mount(VIEW);
    const rows = await screen.findAllByTestId('preview-login');
    expect(rows.map((r) => within(r).getByTestId('preview-login-link').textContent)).toEqual([
      `${window.location.origin}/login?token=AAAA-1`,
      `${window.location.origin}/login?token=BBBB-2`,
    ]);
    expect(rows[0]?.textContent).toContain('Kontrolle');
    expect(rows[1]?.textContent).toContain('Keine Rolle');
    expect(screen.getByRole('heading', { name: 'Vorschau-Logins' })).toBeTruthy();
    cleanup();
    mount(VIEW, VIEW, 'en');
    expect((await screen.findAllByTestId('preview-login'))[1]?.textContent).toContain('No role');
  });

  it('says so when there is no preview yet, and when the logins cannot be read', async () => {
    mount({ status: 'dropped', logins: [] });
    expect(await screen.findByText(/Die Vorschau entsteht/)).toBeTruthy();
    cleanup();
    mount(null);
    expect((await screen.findByRole('alert')).textContent).toContain('konnten nicht gelesen werden');
  });
});

describe('copy', () => {
  it('copies the full link and shows "Kopiert!" on that row only', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    mount(VIEW);
    const rows = await screen.findAllByTestId('preview-login');
    await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Link kopieren' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/login?token=AAAA-1`),
    );
    expect(within(rows[0] as HTMLElement).getByRole('button', { name: 'Kopiert!' })).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: 'Link kopieren' })).toBeTruthy();
  });
});

describe('Demo-Daten zurücksetzen', () => {
  it('asks first, then resets and shows the new logins; Abbrechen resets nothing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const after: PreviewView = {
      ...VIEW,
      logins: VIEW.logins.map((l) => ({ ...l, participantId: `${l.participantId}2` })),
    };
    const client = mount(VIEW, after);
    await screen.findAllByTestId('preview-login');
    await user.click(screen.getByRole('button', { name: 'Demo-Daten zurücksetzen' }));
    const ask = await screen.findByRole('alertdialog');
    await user.click(within(ask).getByRole('button', { name: 'Abbrechen' }));
    expect(client.resetPreview).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Demo-Daten zurücksetzen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Demo-Daten zurücksetzen' }),
    );
    await waitFor(() => expect(client.resetPreview).toHaveBeenCalledWith('de'));
    await waitFor(() => expect(screen.getAllByTestId('preview-login')).toHaveLength(2));
  });

  it('a failed reset says so and keeps the list', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount(VIEW, null);
    await screen.findAllByTestId('preview-login');
    await user.click(screen.getByRole('button', { name: 'Demo-Daten zurücksetzen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Demo-Daten zurücksetzen' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Zurücksetzen ist fehlgeschlagen');
    expect(screen.getAllByTestId('preview-login')).toHaveLength(2);
  });
});
