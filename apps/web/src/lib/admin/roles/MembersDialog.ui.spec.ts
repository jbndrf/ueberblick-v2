// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { setViewport, shimLayout } from '../participants/page.testkit';
import MembersDialog from './MembersDialog.svelte';

shimLayout();
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
});

const PEOPLE = [
  { id: 'anna-1', name: 'Anna' },
  { id: 'bernd-2', name: 'Bernd' },
];

// A person typed into the picker reloads the page data, which hands the dialog new `members` and `people` while the admin
// is still choosing (found in the browser: the pick was reset and the picker stayed open).
describe('MembersDialog keeps the pick when its props change while it is open', () => {
  it('a fresh `members` array with the same ids changes nothing, and Speichern sends the difference to the start', async () => {
    setViewport(1280);
    const user = userEvent.setup();
    const onsave = vi.fn();
    const props = {
      open: true,
      locale: 'de' as const,
      people: PEOPLE,
      members: ['anna-1'],
      createPerson: vi.fn(),
      onsave,
    };
    const view = render(MembersDialog, props);
    const dialog = await screen.findByRole('dialog', { name: 'Teilnehmende bearbeiten' });
    await user.click(dialog.querySelector('button[aria-haspopup]') as HTMLElement);
    await user.click(await screen.findByRole('option', { name: /Bernd/ }));
    await user.click(dialog.querySelector('button[aria-haspopup]') as HTMLElement); // closes the dropdown

    await view.rerender({
      ...props,
      members: ['anna-1'],
      people: [...PEOPLE, { id: 'dora-9', name: 'Dora' }],
    });
    await waitFor(() => expect(within(dialog).getByText('Bernd')).toBeTruthy()); // still picked

    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(onsave).toHaveBeenCalledWith({ add: ['bernd-2'], remove: [] });
  });
});
