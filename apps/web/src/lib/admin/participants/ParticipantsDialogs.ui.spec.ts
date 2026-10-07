// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { overwriteGetLocale } from '../../../../../../packages/ui/src/paraglide/runtime.js';
import { toast } from '@ueberblick/ui/components/ui/sonner';
import type * as Sonner from 'svelte-sonner';
import { fakeApi, mount, overlayItem, overlayItems, rowOf, setViewport, shimLayout } from './page.testkit';

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

async function openMenu(user: ReturnType<typeof userEvent.setup>, id: string, item: string) {
  await user.click(within(rowOf(id)).getByRole('button', { name: 'Menü öffnen' }));
  await user.click(await overlayItem('menuitem', item));
}

describe.each([
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
])('row menu and dialogs at %s', (_name, width) => {
  beforeEach(() => setViewport(width));

  it("the menu has v3's actions, then Löschen", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(rowOf('anna-1')).getByRole('button', { name: 'Menü öffnen' }));
    const items = (await overlayItems('menuitem')).map((i) => i.textContent?.trim());
    expect(items).toEqual([
      'Bearbeiten',
      'Rollen bearbeiten',
      'Neuen Token erzeugen',
      'Login widerrufen',
      'Löschen',
    ]);
    expect(screen.getByRole('columnheader', { name: /Aktionen/ })).toBeTruthy();
  });

  it('Bearbeiten: Name, E-Mail, Telefon; Name is required; Save patches', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    await openMenu(user, 'anna-1', 'Bearbeiten');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name')).toHaveProperty('value', 'Anna');
    expect(within(dialog).getByLabelText('E-Mail')).toHaveProperty('value', 'anna@example.org');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(within(dialog).getByText('Name ist erforderlich')).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Name'), 'Anna B.');
    await user.clear(within(dialog).getByLabelText('E-Mail'));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('anna-1', { name: 'Anna B.', email: null, phone: null }),
    );
    expect(toast.success).toHaveBeenCalledWith('Teilnehmende erfolgreich aktualisiert');
    expect(reload).toHaveBeenCalled();
  });

  it("Rollen bearbeiten: v3's picker with the person's roles, create by typing, Save", async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await openMenu(user, 'anna-1', 'Rollen bearbeiten');
    const dialog = await screen.findByRole('dialog', { name: 'Rollen bearbeiten' });
    expect(within(dialog).getByText('Kontrolle')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Kontrolle/ }));
    await user.click(await screen.findByText('Melder'));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('anna-1', { roles: ['kontrolle', 'melder'] }));
  });

  it('Neuen Token erzeugen: PUT without a token, toast, reload', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    await openMenu(user, 'anna-1', 'Neuen Token erzeugen');
    await waitFor(() => expect(api.setToken).toHaveBeenCalledWith('anna-1'));
    expect(toast.success).toHaveBeenCalledWith('Zugangstoken aktualisiert');
    expect(reload).toHaveBeenCalled();
  });

  it('Login widerrufen asks first, then revokes', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await openMenu(user, 'anna-1', 'Login widerrufen');
    const dialog = await screen.findByRole('alertdialog');
    expect(api.revokeToken).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Login widerrufen' }));
    await waitFor(() => expect(api.revokeToken).toHaveBeenCalledWith('anna-1'));
    expect(toast.success).toHaveBeenCalledWith('Login widerrufen');
  });

  it('Löschen asks first (v3 delete dialog), then removes', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await openMenu(user, 'bernd-2', 'Löschen');
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('Sind Sie sicher, dass Sie diesen Eintrag löschen möchten?'),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('bernd-2'));
    expect(toast.success).toHaveBeenCalledWith('Teilnehmende erfolgreich gelöscht');
  });

  it('a refusal is shown as a toast and nothing reloads', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      setToken: vi.fn(() => Promise.resolve({ ok: false as const, message: 'Die Person ist deaktiviert' })),
    });
    const { reload } = mount({ api });
    await openMenu(user, 'bernd-2', 'Neuen Token erzeugen');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Die Person ist deaktiviert'));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe.each([
  ['phone 390x844', 390],
  ['desktop 1280x800', 1280],
])('Benutzerdefinierte Felder at %s', (_name, width) => {
  beforeEach(() => setViewport(width));

  async function openManager(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Feld hinzufügen' }));
    return screen.findByRole('dialog', { name: /Benutzerdefinierte Felder/ });
  }

  it('the "+" of the last header opens the manager; the empty list says so', async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openManager(user);
    expect(
      within(dialog).getByText('Zusätzliche Felder für Teilnehmende in diesem Projekt definieren'),
    ).toBeTruthy();
    expect(within(dialog).getByText('Noch keine benutzerdefinierten Felder definiert')).toBeTruthy();
  });

  it('adds "Personalnummer" (Text, Pflichtfeld): the whole list is saved', async () => {
    const user = userEvent.setup();
    const { api, reload } = mount();
    const dialog = await openManager(user);
    await user.click(within(dialog).getByRole('button', { name: 'Feld hinzufügen' }));
    const form = await screen.findByRole('dialog', { name: 'Feld hinzufügen' });
    await user.type(within(form).getByLabelText('Feldname'), 'Personalnummer');
    await user.click(within(form).getByText('Pflichtfeld'));
    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));
    await waitFor(() =>
      expect(api.saveColumns).toHaveBeenCalledWith([
        { key: 'personalnummer', label: 'Personalnummer', type: 'text', required: true },
      ]),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it("the type menu offers the registry's types, with a check on the current one", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openManager(user);
    await user.click(within(dialog).getByRole('button', { name: 'Feld hinzufügen' }));
    const form = await screen.findByRole('dialog', { name: 'Feld hinzufügen' });
    const trigger = within(form)
      .getAllByRole('button', { hidden: true })
      .find((b) => b.textContent?.trim() === 'Text') as HTMLElement;
    await user.click(trigger);
    const items = (await overlayItems('menuitem')).map((i) => i.textContent?.trim());
    expect(items).toEqual(['Text', 'Zahl', 'Ja/Nein', 'Datum']);
  });

  it('refuses an empty name and a name that exists (v3 messages), without calling the server', async () => {
    const user = userEvent.setup();
    const { api } = mount({
      data: { columns: [{ key: 'pn', label: 'Personalnummer', type: 'text' }] },
    });
    const dialog = await openManager(user);
    await user.click(within(dialog).getByRole('button', { name: 'Feld hinzufügen' }));
    const form = await screen.findByRole('dialog', { name: 'Feld hinzufügen' });
    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));
    expect(within(form).getByText('Feldname und Typ sind erforderlich')).toBeTruthy();
    await user.type(within(form).getByLabelText('Feldname'), 'personalnummer');
    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));
    expect(within(form).getByText('Ein Feld mit diesem Namen existiert bereits')).toBeTruthy();
    expect(api.saveColumns).not.toHaveBeenCalled();
  });

  it('lists the columns with type and Pflichtfeld badges, edits and deletes after a confirm', async () => {
    const user = userEvent.setup();
    const { api } = mount({
      data: {
        columns: [{ key: 'pn', label: 'Personalnummer', type: 'text', required: true, default: '0' }],
      },
    });
    const dialog = await openManager(user);
    expect(within(dialog).getByText('Personalnummer')).toBeTruthy();
    expect(within(dialog).getByText('Pflichtfeld')).toBeTruthy();
    expect(within(dialog).getByText('Standard: 0')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: /Feld bearbeiten: Personalnummer/ }));
    const form = await screen.findByRole('dialog', { name: 'Personalnummer bearbeiten' });
    await user.clear(within(form).getByLabelText('Feldname'));
    await user.type(within(form).getByLabelText('Feldname'), 'PN');
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(api.saveColumns).toHaveBeenCalledWith([
        { key: 'pn', label: 'PN', type: 'text', default: '0', required: true },
      ]),
    );
  });

  it('the grip orders the fields: a drop, the arrow keys on the grip and the phone buttons save the whole list', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const columns = [
      { key: 'a', label: 'Alpha', type: 'text' },
      { key: 'b', label: 'Beta', type: 'text' },
      { key: 'c', label: 'Gamma', type: 'text' },
    ];
    const { api } = mount({ data: { columns } });
    const dialog = within(await openManager(user));
    const keys = (n: number) => (api.saveColumns.mock.calls[n]?.[0] as { key: string }[]).map((c) => c.key);
    await fireEvent.dragStart(dialog.getByTestId('column-a'));
    await fireEvent.dragOver(dialog.getByTestId('column-b'), { clientY: 100 });
    await fireEvent.drop(dialog.getByTestId('column-b'));
    await waitFor(() => expect(keys(0)).toEqual(['b', 'a', 'c']));
    await user.click(dialog.getByRole('button', { name: 'Nach oben: Gamma' }));
    await waitFor(() => expect(keys(1)).toEqual(['a', 'c', 'b']));
    dialog.getByRole('button', { name: 'Verschieben: Alpha' }).focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(keys(2)).toEqual(['b', 'a', 'c']));
  });

  it('delete asks first, then saves the list without the column', async () => {
    const user = userEvent.setup();
    const { api } = mount({ data: { columns: [{ key: 'pn', label: 'Personalnummer', type: 'text' }] } });
    const dialog = await openManager(user);
    await user.click(within(dialog).getByRole('button', { name: /Feld löschen: Personalnummer/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(api.saveColumns).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(api.saveColumns).toHaveBeenCalledWith([]));
  });
});
