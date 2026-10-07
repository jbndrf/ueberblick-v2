// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { overwriteGetLocale } from '../../../../../../packages/ui/src/paraglide/runtime.js';
import { toast } from '@ueberblick/ui/components/ui/sonner';
import type * as Sonner from 'svelte-sonner';
import type * as QrPdf from './qr-pdf';
import { draftStatus } from '../draft/status-store.svelte';
import { fakeApi, mount, rowOf, setViewport, shimLayout } from './page.testkit';
import * as qr from './qr-pdf';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('./qr-pdf', async (original) => ({
  ...(await original<typeof QrPdf>()),
  exportQrPdf: vi.fn(() => Promise.resolve()),
}));

shimLayout();
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  vi.clearAllMocks();
  overwriteGetLocale(() => 'en');
});

// WP-324: v3's Teilnehmende page (reference participants/+page.svelte), at the two journey sizes.
describe.each([
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
])('Teilnehmende at %s', (_name, width) => {
  beforeEach(() => setViewport(width));

  it('has v3 header, columns and the roster', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Teilnehmende' })).toBeTruthy();
    expect(screen.getByText('Teilnehmende und ihre Zugangstoken verwalten')).toBeTruthy();
    for (const label of ['Name', 'E-Mail', 'Telefon', 'Zugangstoken', 'Rollen', 'Status'])
      expect(screen.getByRole('columnheader', { name: new RegExp(label) })).toBeTruthy();
    expect(within(rowOf('anna-1')).getByText('Anna')).toBeTruthy();
    expect(within(rowOf('anna-1')).getByText('Kontrolle')).toBeTruthy();
    expect(within(rowOf('anna-1')).getByText('AAAA-AAAA')).toBeTruthy();
    expect(screen.getByLabelText('Gäste anzeigen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /QR exportieren/ })).toBeNull(); // only while rows are ticked
  });

  it('the empty roster is just the add row (v3 base-table.svelte:720: no empty text while the add row is on)', () => {
    mount({ data: { people: [] } });
    expect(document.querySelector('[data-add-row]')).toBeTruthy();
    expect(document.querySelectorAll('[data-row-id]')).toHaveLength(0);
  });

  it('is English when the admin chose English', () => {
    mount({ locale: 'en' });
    expect(screen.getByRole('heading', { name: 'Participants' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Access token/ })).toBeTruthy();
    expect(screen.getByLabelText('Show guests')).toBeTruthy();
  });

  it('search comes from BaseTable', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByRole('searchbox', { name: 'Suchen' }), 'Bern');
    await waitFor(() => {
      expect(rowOf('bernd-2')).toBeTruthy();
      expect(rowOf('anna-1')).toBeNull();
    });
  });

  it('"Gäste anzeigen" tells the route, which reloads with ?showGuests', async () => {
    const user = userEvent.setup();
    const { onGuests } = mount();
    await user.click(screen.getByRole('switch', { name: 'Gäste anzeigen' }));
    expect(onGuests).toHaveBeenCalledWith(true);
  });

  it('Status switches a person off and on, outside Bearbeitungsmodus', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    await user.click(within(rowOf('anna-1')).getByRole('switch', { name: 'Status' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('anna-1', { disabled: true }));
    await user.click(within(rowOf('bernd-2')).getByRole('switch', { name: 'Status' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('bernd-2', { disabled: false }));
    expect(reload).toHaveBeenCalled();
  });

  it('copy puts the login link on the clipboard', async () => {
    const user = userEvent.setup();
    mount();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(within(rowOf('anna-1')).getByRole('button', { name: 'Kopieren' }));
    expect(write).toHaveBeenCalledWith('https://ueb.test/login?token=AAAA-AAAA');
  });
});

/** An option inside the open picker (full-screen dialog on a phone, dropdown on desktop). */
async function pick(label: string): Promise<HTMLElement> {
  return waitFor(() => {
    const layer = document.querySelector<HTMLElement>('[role=listbox], [role=dialog]');
    expect(layer).toBeTruthy();
    return within(layer as HTMLElement).getByText(label);
  });
}

describe.each([390, 1280])(
  'inline add at %ipx (v3 "Teilnehmende erstellen" row: Name, Rollen, check)',
  (width) => {
    beforeEach(() => setViewport(width));

    async function typeName(user: ReturnType<typeof userEvent.setup>, name: string) {
      const addRow = document.querySelector('[data-add-row]') as HTMLElement;
      await user.click(within(addRow).getAllByRole('button', { name: '-' })[0] as HTMLElement);
      await user.type(within(addRow).getByRole('textbox'), `${name}{Enter}`);
      return addRow;
    }

    it('adds Anna with a role: add, then a token, then the roster reloads', async () => {
      const user = userEvent.setup();
      const { api, reload } = mount();
      const addRow = await typeName(user, 'Dora');
      await user.click(within(addRow).getByRole('button', { name: 'Rollen auswählen oder suchen...' }));
      await user.click(screen.getByRole('button', { name: /^Auswählen oder suchen/ }));
      await user.click(await pick('Melder'));
      await user.keyboard('{Escape}');
      await user.click(within(addRow).getByRole('button', { name: 'Speichern' }));
      await user.click(within(addRow).getByRole('button', { name: 'Zeile hinzufügen' }));
      await waitFor(() =>
        expect(api.add).toHaveBeenCalledWith({ name: 'Dora', roles: ['melder'], attrs: {} }),
      );
      expect(api.setToken).toHaveBeenCalledWith('new-1');
      expect(toast.success).toHaveBeenCalledWith('Teilnehmende erfolgreich erstellt');
      expect(reload).toHaveBeenCalled();
    });

    it('an empty name is not sent (v3 marks the cell and refuses)', async () => {
      const user = userEvent.setup();
      const { api } = mount();
      const addRow = document.querySelector('[data-add-row]') as HTMLElement;
      await user.click(within(addRow).getAllByRole('button', { name: '-' })[1] as HTMLElement); // E-Mail
      await user.type(within(addRow).getByRole('textbox'), 'x@y.de{Enter}');
      await user.click(within(addRow).getByRole('button', { name: 'Zeile hinzufügen' }));
      expect(api.add).not.toHaveBeenCalled();
      expect(addRow.querySelector('.ring-destructive')).toBeTruthy();
    });

    it("the server's refusal is shown and the row keeps what was typed", async () => {
      const user = userEvent.setup();
      const api = fakeApi({
        add: vi.fn(() => Promise.resolve({ ok: false as const, message: 'Name ist erforderlich' })),
      });
      mount({ api });
      const addRow = await typeName(user, 'Dora');
      await user.click(within(addRow).getByRole('button', { name: 'Zeile hinzufügen' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Name ist erforderlich'));
      expect(within(addRow).getByText('Dora')).toBeTruthy();
    });

    it('a required custom column must have a value (add without it is refused), a default fills it', async () => {
      const user = userEvent.setup();
      const { api } = mount({
        data: { columns: [{ key: 'personalnummer', label: 'Personalnummer', type: 'text', required: true }] },
      });
      const addRow = await typeName(user, 'Dora');
      await user.click(within(addRow).getByRole('button', { name: 'Zeile hinzufügen' }));
      expect(api.add).not.toHaveBeenCalled();
      const buttons = within(addRow).getAllByRole('button', { name: '-' });
      await user.click(buttons[buttons.length - 1] as HTMLElement);
      await user.type(within(addRow).getByRole('textbox'), '4711{Enter}');
      await user.click(within(addRow).getByRole('button', { name: 'Zeile hinzufügen' }));
      await waitFor(() =>
        expect(api.add).toHaveBeenCalledWith({
          name: 'Dora',
          roles: [],
          attrs: { personalnummer: '4711' },
        }),
      );
    });

    it('a role typed in the Rollen cell is created through the draft route (AP-04)', async () => {
      const user = userEvent.setup();
      const { api } = mount();
      const before = draftStatus.changes;
      const addRow = await typeName(user, 'Chris');
      await user.click(within(addRow).getByRole('button', { name: 'Rollen auswählen oder suchen...' }));
      await user.click(screen.getByRole('button', { name: /^Auswählen oder suchen/ }));
      await user.type(await screen.findByRole('textbox', { name: /suchen/i }), 'Neuling{Enter}');
      await waitFor(() => expect(api.createRole).toHaveBeenCalledWith('Neuling'));
      // the role is in the draft: the shell's publish bar re-reads its status (WP-326)
      await waitFor(() => expect(draftStatus.changes).toBe(before + 1));
    });
  },
);

describe('QR exportieren (n) (AP-05)', () => {
  beforeEach(() => setViewport(1280));

  it('3 ticked rows give 3 badges that carry the login link and the name; a missing token is made first', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    for (const id of ['anna-1', 'bernd-2', 'clara-3'])
      await user.click(within(rowOf(id)).getByRole('checkbox', { name: 'Zeile auswählen' }));
    await user.click(screen.getByRole('button', { name: 'QR exportieren (3)' }));
    await waitFor(() => expect(qr.exportQrPdf).toHaveBeenCalledTimes(1));
    expect(api.setToken).toHaveBeenCalledTimes(1); // Clara had none
    expect(api.setToken).toHaveBeenCalledWith('clara-3');
    expect(qr.exportQrPdf).toHaveBeenCalledWith([
      { name: 'Anna', link: 'https://ueb.test/login?token=AAAA-AAAA' },
      { name: 'Bernd', link: 'https://ueb.test/login?token=BBBB-BBBB' },
      { name: 'Clara', link: 'https://ueb.test/login?token=NEW-TOKEN' },
    ]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('QR-Code PDF erfolgreich exportiert'));
    expect(reload).toHaveBeenCalled();
  });

  it("a failing export shows v3's error toast", async () => {
    const user = userEvent.setup();
    vi.mocked(qr.exportQrPdf).mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount();
    await user.click(within(rowOf('anna-1')).getByRole('checkbox', { name: 'Zeile auswählen' }));
    await user.click(screen.getByRole('button', { name: 'QR exportieren (1)' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Fehler beim Exportieren des QR-Code PDFs'));
  });
});
