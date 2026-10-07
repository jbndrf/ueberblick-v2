// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { overwriteGetLocale } from '../../../../../../packages/ui/src/paraglide/runtime.js';
import { toast } from '@ueberblick/ui/components/ui/sonner';
import type * as Sonner from 'svelte-sonner';
import { draftStatus } from '../draft/status-store.svelte';
import { fakeApi, mount, overlayItem, rowOf, setViewport, shimLayout } from './page.testkit';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

shimLayout();
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  vi.clearAllMocks();
  overwriteGetLocale(() => 'en');
});

const SIZES = [
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
] as const;

async function rowAction(user: ReturnType<typeof userEvent.setup>, id: string, name: string): Promise<void> {
  await user.click(within(rowOf(id)).getByRole('button', { name: 'Menü öffnen' }));
  await user.click(await overlayItem('menuitem', name));
}
const OPEN_JOIN = 'Beitritts-URL & Voreinstellungen anzeigen';

// WP-367: v3's Selbstbeitritt switch (roles/+page.svelte:324-336) and the join dialog (:487-609).
describe.each(SIZES)('Selbstbeitritt switch at %s', (_n, width) => {
  beforeEach(() => setViewport(width));
  const sw = (id: string) => within(rowOf(id)).getByRole('switch', { name: 'Selbstbeitritt' });

  it('is a column with a switch per role showing the state of the link', () => {
    mount();
    expect(screen.getByRole('columnheader', { name: /Selbstbeitritt/ })).toBeTruthy();
    expect(sw('kontrolle').getAttribute('aria-checked')).toBe('true');
    expect(sw('bauhof').getAttribute('aria-checked')).toBe('false');
  });

  it('on applies at once with a toast, and is not a draft change (no publish bar)', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    const before = draftStatus.changes;
    await user.click(sw('bauhof'));
    await waitFor(() => expect(api.setSelfJoin).toHaveBeenCalledWith('bauhof', true));
    expect(toast.success).toHaveBeenCalledWith('Selbstbeitritt aktiviert');
    expect(reload).toHaveBeenCalled();
    expect(draftStatus.changes).toBe(before);
  });

  it('off applies at once with its own toast', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await user.click(sw('kontrolle'));
    await waitFor(() => expect(api.setSelfJoin).toHaveBeenCalledWith('kontrolle', false));
    expect(toast.success).toHaveBeenCalledWith('Selbstbeitritt deaktiviert');
  });

  it("a failure is v3's error toast", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ setSelfJoin: vi.fn(() => Promise.resolve({ ok: false as const, message: 'x' })) });
    mount({ api });
    await user.click(sw('bauhof'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Selbstbeitritt konnte nicht aktualisiert werden'),
    );
  });

  it('the new-role row has no switch (v3: excluded from the add row)', () => {
    mount();
    expect(
      within(document.querySelector('[data-add-row]') as HTMLElement).queryAllByRole('switch'),
    ).toHaveLength(0);
  });
});

describe.each(SIZES)('the join dialog at %s', (_n, width) => {
  beforeEach(() => setViewport(width));

  it('says to switch it on first when the link is off (v3 openJoinInfo)', async () => {
    const user = userEvent.setup();
    mount();
    await rowAction(user, 'bauhof', OPEN_JOIN);
    expect(toast.error).toHaveBeenCalledWith(
      'Aktivieren Sie zuerst den Selbstbeitritt, um eine URL zu erhalten',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows URL, quota and the defaults list with the role home view instead of /map', async () => {
    const user = userEvent.setup();
    mount();
    await rowAction(user, 'kontrolle', OPEN_JOIN);
    const dialog = await screen.findByRole('dialog', { name: /Selbstbeitritts-Link/ });
    expect(within(dialog).getAllByText(/Baumkontrolle/).length).toBeGreaterThan(0);
    expect((within(dialog).getByLabelText('Beitritts-URL') as HTMLInputElement).value).toBe(
      `${window.location.origin}/join/baum-kontrolle`,
    );
    expect((within(dialog).getByLabelText(/Max\. Arbeitsabläufe/) as HTMLInputElement).value).toBe('3');
    const list = within(dialog).getByText('Voreinstellungen beim Selbstbeitritt')
      .nextElementSibling as HTMLElement;
    for (const [label, value] of [
      ['Name', 'Gast'],
      ['Rolle', 'Baumkontrolle'],
      ['Aktiv', 'Ja'],
      ['Landet auf', 'Karte'],
      ['Automatisch gelöscht nach', '90 Tagen Inaktivität'],
    ] as [string, string][])
      expect(within(list).getByText(label).parentElement?.textContent).toContain(value);
    expect(list.textContent).not.toContain('/map');
    expect(list.textContent).not.toContain('placeholder.local');
  });

  it('copies the URL with v3 toast', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    mount();
    await rowAction(user, 'kontrolle', OPEN_JOIN);
    const dialog = await screen.findByRole('dialog', { name: /Selbstbeitritts-Link/ });
    await user.click(within(dialog).getByRole('button', { name: 'Kopieren' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/baum-kontrolle`),
    );
    expect(toast.success).toHaveBeenCalledWith('Beitritts-URL in die Zwischenablage kopiert');
  });

  it('a copy that fails shows the error toast', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('no'));
    mount();
    await rowAction(user, 'kontrolle', OPEN_JOIN);
    const dialog = await screen.findByRole('dialog', { name: /Selbstbeitritts-Link/ });
    await user.click(within(dialog).getByRole('button', { name: 'Kopieren' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('URL konnte nicht kopiert werden'));
  });

  it('saving the quota is a draft edit: api call, toast, publish bar, reload', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    const before = draftStatus.changes;
    await rowAction(user, 'kontrolle', OPEN_JOIN);
    const dialog = await screen.findByRole('dialog', { name: /Selbstbeitritts-Link/ });
    expect(within(dialog).getByText(/Entwurf gespeichert .* nach dem Veröffentlichen/)).toBeTruthy();
    const field = within(dialog).getByLabelText(/Max\. Arbeitsabläufe/);
    await user.clear(field);
    await user.type(field, '5');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.setQuota).toHaveBeenCalledWith('kontrolle', 5));
    expect(toast.success).toHaveBeenCalledWith('Kontingent im Entwurf gespeichert');
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('0 is sent as 0 (unbegrenzt); a negative, fractional or empty number is refused before any call', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await rowAction(user, 'kontrolle', OPEN_JOIN);
    const dialog = await screen.findByRole('dialog', { name: /Selbstbeitritts-Link/ });
    const field = within(dialog).getByLabelText(/Max\. Arbeitsabläufe/);
    const save = within(dialog).getByRole('button', { name: 'Speichern' });
    for (const bad of ['-1', '1.5']) {
      await user.clear(field);
      await user.type(field, bad);
      await user.click(save);
    }
    await user.clear(field);
    await user.click(save);
    expect(api.setQuota).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(3);
    expect(toast.error).toHaveBeenCalledWith('Kontingent muss eine nicht-negative Ganzzahl sein');
    await user.type(field, '0');
    await user.click(save);
    await waitFor(() => expect(api.setQuota).toHaveBeenCalledWith('kontrolle', 0));
  });

  it("a refused quota shows the server's message and keeps the dialog", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      setQuota: vi.fn(() => Promise.resolve({ ok: false as const, message: 'Abgelehnt' })),
    });
    mount({ api });
    await rowAction(user, 'kontrolle', OPEN_JOIN);
    const dialog = await screen.findByRole('dialog', { name: /Selbstbeitritts-Link/ });
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Abgelehnt'));
    expect(screen.getByRole('dialog', { name: /Selbstbeitritts-Link/ })).toBeTruthy();
  });

  it('Schließen closes it', async () => {
    const user = userEvent.setup();
    mount();
    await rowAction(user, 'kontrolle', OPEN_JOIN);
    const dialog = await screen.findByRole('dialog', { name: /Selbstbeitritts-Link/ });
    // the kit's corner X is named in the app language now (WP-713), so two buttons are called Schließen: both close it
    await user.click(within(dialog).getAllByRole('button', { name: 'Schließen' })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a role without a home view lands on /map as in v3', async () => {
    const user = userEvent.setup();
    mount({
      data: {
        roles: [
          {
            key: 'r',
            label: 'R',
            description: '',
            members: [],
            selfJoin: { enabled: true, slug: 'r-slug' },
            quota: 0,
            home: '',
          },
        ],
      },
    });
    await rowAction(user, 'r', OPEN_JOIN);
    const dialog = await screen.findByRole('dialog', { name: /Selbstbeitritts-Link/ });
    expect(within(dialog).getByText('/map')).toBeTruthy();
  });
});
