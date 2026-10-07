// @vitest-environment jsdom
// WP-636: the action row shows the button label, colour and icon of each task and asks before a task with a
// confirmation starts; while a quick edit is open it is Abbrechen / Speichern (v3 detail module :1226-1250).
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Key } from '@ueberblick/core/model';
import '@ueberblick/ui/testing';
import ActionRow from './ActionRow.svelte';
import type { PresentedTask } from './task-presentation';

afterEach(() => {
  cleanup();
  document.body.removeAttribute('style');
});

const tasks: PresentedTask[] = [
  { key: 'pflege' as Key, label: 'Pflegen', color: '#16a34a', icon: 'leaf', confirm: 'Wirklich pflegen?' },
  { key: 'melden' as Key, label: 'Melden' },
];
const props = (over: Record<string, unknown> = {}) => ({
  tasks,
  label: 'Aufgaben',
  locale: 'de' as const,
  onstart: vi.fn(),
  ...over,
});

describe('action row', () => {
  it('draws the label, the colour and the icon of the button', () => {
    const { container } = render(ActionRow, props());
    const button = screen.getByRole('button', { name: 'Pflegen' });
    expect(button.getAttribute('style')).toContain('--btn-color: #16a34a');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Melden' }).querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  it('a task without a confirmation starts on tap', async () => {
    const p = props();
    render(ActionRow, p);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Melden' }));
    expect(p.onstart).toHaveBeenCalledWith('melden');
  });

  it('a task with a confirmation asks first; Abbrechen starts nothing, Fortfahren starts it', async () => {
    const p = props();
    render(ActionRow, p);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Pflegen' }));
    expect(await screen.findByText('Wirklich pflegen?')).toBeTruthy();
    expect(p.onstart).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(p.onstart).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Wirklich pflegen?')).toBeNull());
    document.body.removeAttribute('style');
    await user.click(screen.getByRole('button', { name: 'Pflegen' }));
    await user.click(await screen.findByRole('button', { name: 'Fortfahren' }));
    expect(p.onstart).toHaveBeenCalledExactlyOnceWith('pflege');
  });

  it('while a quick edit is open the row is Abbrechen and Speichern', async () => {
    const edit = { saving: false, oncancel: vi.fn(), onsave: vi.fn() };
    render(ActionRow, props({ edit }));
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Pflegen' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(edit.onsave).toHaveBeenCalledTimes(1);
    expect(edit.oncancel).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations', async () => {
    const { container } = render(ActionRow, props());
    const result = await axe.run(container);
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
