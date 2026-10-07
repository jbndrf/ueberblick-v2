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

/** Opens the "⋮" menu of a row and picks an entry (Bearbeiten, Teilnehmende bearbeiten, Löschen). */
async function rowAction(user: ReturnType<typeof userEvent.setup>, id: string, name: string): Promise<void> {
  await user.click(within(rowOf(id)).getByRole('button', { name: 'Menü öffnen' }));
  await user.click(await overlayItem('menuitem', name));
}

// WP-346: v3's Rollen page (reference roles/+page.svelte), at the two journey sizes.
describe.each(SIZES)('Rollen at %s', (_name, width) => {
  beforeEach(() => setViewport(width));

  it('has v3 header, the one tab, columns and the roles with their participant counts', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Rollen' })).toBeTruthy();
    expect(screen.getByText('Rollen und Berechtigungen für Teilnehmende verwalten')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Rollen' })).toBeTruthy();
    for (const label of ['Rollenname', 'Beschreibung', 'Zugewiesene Teilnehmende'])
      expect(screen.getByRole('columnheader', { name: new RegExp(label) })).toBeTruthy();
    expect(within(rowOf('kontrolle')).getByText('Baumkontrolle')).toBeTruthy();
    expect(within(rowOf('kontrolle')).getByText('Kontrolliert Bäume')).toBeTruthy();
    expect(within(rowOf('kontrolle')).getByText('2')).toBeTruthy();
    expect(within(rowOf('bauhof')).getByText('0')).toBeTruthy();
  });

  it('is English when the admin chose English', () => {
    mount({ locale: 'en' });
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Assigned participants/ })).toBeTruthy();
  });

  it('search finds a role by name or description (v3 globalFilterFn)', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByRole('searchbox', { name: 'Suchen' }), 'Bäume');
    await waitFor(() => {
      expect(rowOf('kontrolle')).toBeTruthy();
      expect(rowOf('bauhof')).toBeNull();
    });
  });

  it('the empty list is just the add row', () => {
    mount({ data: { roles: [] } });
    expect(document.querySelector('[data-add-row]')).toBeTruthy();
    expect(document.querySelectorAll('[data-row-id]')).toHaveLength(0);
  });
});

describe.each(SIZES)(
  'inline "Rolle erstellen" at %s (v3 add row: Rollenname, Beschreibung, check)',
  (_n, width) => {
    beforeEach(() => setViewport(width));

    async function fill(
      user: ReturnType<typeof userEvent.setup>,
      cell: number,
      text: string,
    ): Promise<HTMLElement> {
      const addRow = document.querySelector('[data-add-row]') as HTMLElement;
      await user.click(within(addRow).getAllByRole('button', { name: '-' })[cell] as HTMLElement);
      await user.type(within(addRow).getByRole('textbox'), `${text}{Enter}`);
      return addRow;
    }

    it('creates a role with name and description, tells the publish bar and reloads', async () => {
      const user = userEvent.setup();
      const { api, reload } = mount();
      const before = draftStatus.changes;
      await fill(user, 0, 'Gutachter');
      const addRow = await fill(user, 0, 'Prüft Meldungen');
      await user.click(within(addRow).getByRole('button', { name: 'Zeile hinzufügen' }));
      await waitFor(() => expect(api.create).toHaveBeenCalledWith('Gutachter', 'Prüft Meldungen'));
      expect(toast.success).toHaveBeenCalledWith('Rolle erfolgreich erstellt');
      expect(draftStatus.changes).toBe(before + 1); // the role is in the draft: the shell's publish bar follows (WP-326)
      expect(reload).toHaveBeenCalled();
    });

    it('a row without a name is not sent', async () => {
      const user = userEvent.setup();
      const { api } = mount();
      const addRow = await fill(user, 1, 'nur Beschreibung');
      await user.click(within(addRow).getByRole('button', { name: 'Zeile hinzufügen' }));
      expect(api.create).not.toHaveBeenCalled();
      expect(addRow.querySelector('.ring-destructive')).toBeTruthy();
    });

    it("the server's refusal is shown and the row keeps what was typed", async () => {
      const user = userEvent.setup();
      const api = fakeApi({
        create: vi.fn(() =>
          Promise.resolve({ ok: false as const, message: 'Der Name muss mindestens 2 Zeichen lang sein' }),
        ),
      });
      mount({ api });
      const addRow = await fill(user, 0, 'A');
      await user.click(within(addRow).getByRole('button', { name: 'Zeile hinzufügen' }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Der Name muss mindestens 2 Zeichen lang sein'),
      );
      expect(within(addRow).getByText('A')).toBeTruthy();
    });
  },
);

describe.each(SIZES)('rename and describe at %s', (_n, width) => {
  beforeEach(() => setViewport(width));

  it('in place, in Bearbeitungsmodus: the key stays, only the name is sent', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    await user.click(screen.getByRole('switch', { name: 'Rollen inline bearbeiten' }));
    await user.click(within(rowOf('bauhof')).getByRole('button', { name: /Bauhof/ }));
    const input = within(rowOf('bauhof')).getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Bauhof Nord{Enter}');
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('bauhof', { name: 'Bauhof Nord' }));
    expect(reload).toHaveBeenCalled();
  });

  it('with the row menu "Bearbeiten": a dialog with name and description (v3 crud-dialogs edit)', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    const before = draftStatus.changes;
    await rowAction(user, 'kontrolle', 'Bearbeiten');
    const dialog = await screen.findByRole('dialog', { name: 'Rolle bearbeiten' });
    const name = within(dialog).getByLabelText('Rollenname') as HTMLInputElement;
    expect(name.value).toBe('Baumkontrolle');
    expect((within(dialog).getByLabelText('Beschreibung') as HTMLTextAreaElement).value).toBe(
      'Kontrolliert Bäume',
    );
    await user.clear(name);
    await user.type(name, 'Baumkontrolleurin');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith('kontrolle', {
        name: 'Baumkontrolleurin',
        description: 'Kontrolliert Bäume',
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Rolle erfolgreich aktualisiert');
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  // WP-497: the success toast is what a user (and the e2e) waits for; the row must already be current when it shows.
  it('the success toast waits for the reload, so the row is current when it shows', async () => {
    const user = userEvent.setup();
    const { reload } = mount();
    let finish: () => void = () => undefined;
    reload.mockImplementationOnce(() => new Promise<void>((done) => (finish = done)));
    await rowAction(user, 'kontrolle', 'Bearbeiten');
    const dialog = await screen.findByRole('dialog', { name: 'Rolle bearbeiten' });
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rolle erfolgreich aktualisiert'));
  });

  it('a name under two characters is refused in the dialog', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await rowAction(user, 'bauhof', 'Bearbeiten');
    const dialog = await screen.findByRole('dialog', { name: 'Rolle bearbeiten' });
    const name = within(dialog).getByLabelText('Rollenname');
    await user.clear(name);
    await user.type(name, 'B');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(api.update).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert').textContent).toContain('mindestens 2 Zeichen');
  });
});

describe.each(SIZES)('delete at %s', (_n, width) => {
  beforeEach(() => setViewport(width));

  it("asks first and lists the Doc's problems and the people who have the role", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      preview: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            uses: [{ path: 'tasks.kontrolle.perms', message: 'Die Rolle "kontrolle" gibt es nicht' }],
            people: [{ id: 'anna-1', name: 'Anna' }],
          },
        }),
      ),
    });
    const { reload } = mount({ api });
    const before = draftStatus.changes;
    await rowAction(user, 'kontrolle', 'Löschen');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Rolle löschen')).toBeTruthy();
    expect(within(dialog).getByText('Sind Sie sicher, dass Sie diese Rolle löschen möchten?')).toBeTruthy();
    await waitFor(() => {
      expect(within(dialog).getByTestId('delete-uses').textContent).toContain('tasks.kontrolle.perms');
      expect(within(dialog).getByTestId('delete-people').textContent).toContain('Anna');
    });
    expect(api.remove).not.toHaveBeenCalled(); // nothing is deleted before the admin confirms
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(['kontrolle']));
    expect(toast.success).toHaveBeenCalledWith('Rolle erfolgreich gelöscht');
    expect(draftStatus.changes).toBe(before + 1);
    expect(reload).toHaveBeenCalled();
  });

  it('cancel deletes nothing', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await rowAction(user, 'bauhof', 'Löschen');
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(api.remove).not.toHaveBeenCalled();
  });
});

describe.each(SIZES)('"Teilnehmende bearbeiten" at %s', (_n, width) => {
  beforeEach(() => setViewport(width));

  const trigger = (): HTMLElement =>
    document.querySelector('[role=dialog] button[aria-haspopup]') as HTMLElement;

  /** The picker is a dropdown on desktop and a full-screen dialog on a phone. Returns the open layer. */
  async function openPicker(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await screen.findByRole('dialog', { name: 'Teilnehmende bearbeiten' });
    await user.click(trigger());
    return waitFor(() => {
      const layer = document.querySelector<HTMLElement>(
        '[role=listbox], [aria-label="Select options"], [aria-label="Optionen auswählen"]',
      );
      expect(layer).toBeTruthy();
      return layer as HTMLElement;
    });
  }

  /** Closes the picker the way a user does: "Fertig" on a phone, the trigger again on desktop (Escape would close the dialog). */
  async function closePicker(user: ReturnType<typeof userEvent.setup>, layer: HTMLElement): Promise<void> {
    if (width < 768) await user.click(within(layer).getByRole('button', { name: /^(Fertig|Done)/ }));
    else await user.click(trigger());
  }

  it('shows who has the role and saves one change set: Bernd joins, Clara leaves', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    await rowAction(user, 'kontrolle', 'Teilnehmende bearbeiten');
    const layer = await openPicker(user);
    const row = (name: RegExp) => within(layer).getByRole(width < 768 ? 'checkbox' : 'option', { name });
    await user.click(row(/Bernd/));
    await user.click(row(/Clara/));
    await closePicker(user, layer);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.setMembers).toHaveBeenCalledWith('kontrolle', ['bernd-2'], ['clara-3']));
    expect(toast.success).toHaveBeenCalledWith('Teilnehmende erfolgreich aktualisiert');
    expect(reload).toHaveBeenCalled();
  });

  it('a name typed into the picker creates a participant, who is then in the change set', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await rowAction(user, 'bauhof', 'Teilnehmende bearbeiten');
    const layer = await openPicker(user);
    await user.type(
      within(document.querySelector('[role=dialog]') as HTMLElement).getByRole('textbox'),
      'Dora{Enter}',
    );
    await waitFor(() => expect(api.createPerson).toHaveBeenCalledWith('Dora'));
    await closePicker(user, layer);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.setMembers).toHaveBeenCalledWith('bauhof', ['dora-9'], []));
  });
});
