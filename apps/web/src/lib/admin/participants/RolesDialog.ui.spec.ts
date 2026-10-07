// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { setViewport, shimLayout } from './page.testkit';
import RolesDialog from './RolesDialog.svelte';

shimLayout();
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
});

const OPTIONS = [
  { value: 'kontrolle', label: 'Kontrolle' },
  { value: 'melder', label: 'Melder' },
];

// WP-346 found two bugs of this dialog in the browser: new props (a role typed into the picker reloads the page data)
// reset the pick, and bits-ui's `contain` clipped the phone picker to the dialog box.
describe('RolesDialog', () => {
  it('keeps the pick when its props change while it is open', async () => {
    setViewport(1280);
    const user = userEvent.setup();
    const onsave = vi.fn();
    const props = {
      open: true,
      locale: 'de' as const,
      options: OPTIONS,
      roles: ['kontrolle'],
      createRole: vi.fn(),
      onsave,
    };
    const view = render(RolesDialog, props);
    const dialog = await screen.findByRole('dialog', { name: 'Rollen bearbeiten' });
    await user.click(dialog.querySelector('button[aria-haspopup]') as HTMLElement);
    await user.click(await screen.findByRole('option', { name: /Melder/ }));
    await user.click(dialog.querySelector('button[aria-haspopup]') as HTMLElement);

    await view.rerender({
      ...props,
      roles: ['kontrolle'],
      options: [...OPTIONS, { value: 'neu', label: 'Neu' }],
    });
    await waitFor(() => expect(within(dialog).getByText('Melder')).toBeTruthy());
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(onsave).toHaveBeenCalledWith(['kontrolle', 'melder']);
  });

  it('does not contain its picker (the phone picker is full-screen, fixed to the window)', async () => {
    render(RolesDialog, {
      open: true,
      locale: 'de' as const,
      options: OPTIONS,
      roles: [],
      createRole: vi.fn(),
      onsave: vi.fn(),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Rollen bearbeiten' });
    expect(dialog.className).toContain('contain-none!');
  });
});
