// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../jsdom-shims.testing';
import Harness from '../../../testing/Sortable.testing.svelte';

const letters = (): string[] =>
  screen.getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent ?? '');

describe('Sortable', () => {
  it('drops a row after the one it is dragged over and reports the new order', async () => {
    const onreorder = vi.fn();
    render(Harness, { onreorder });
    const a = screen.getByTestId('row-a');
    const b = screen.getByTestId('row-b');
    await fireEvent.dragStart(a);
    await fireEvent.dragOver(b, { clientY: 100 }); // below the middle of a zero-height box: after
    expect(b.className).toContain('after:bg-primary');
    expect(a.className).toContain('opacity-50');
    await fireEvent.drop(b);
    expect(onreorder).toHaveBeenCalledWith({ keys: ['b', 'a', 'c'], moved: 'a' });
    await waitFor(() => expect(letters()).toEqual(['b', 'a', 'c']));
    expect(b.className).not.toContain('after:bg-primary');
  });

  it('does nothing on a drop on the dragged row itself', async () => {
    const onreorder = vi.fn();
    render(Harness, { onreorder });
    const c = screen.getByTestId('row-c');
    await fireEvent.dragStart(c);
    await fireEvent.dragOver(c, { clientY: 0 });
    await fireEvent.drop(c);
    expect(onreorder).not.toHaveBeenCalled();
  });

  it('moves a row with the arrow keys on its handle and keeps focus there', async () => {
    const onreorder = vi.fn();
    render(Harness, { onreorder });
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Move b' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(onreorder).toHaveBeenLastCalledWith({ keys: ['b', 'a', 'c'], moved: 'b' });
    await waitFor(() => expect(letters()).toEqual(['b', 'a', 'c']));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move b' })));
    await user.keyboard('{ArrowUp}'); // at the top: nothing
    expect(onreorder).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('b, 1 of 3');
  });

  it('has an up and a down button per row for a phone; the ends are disabled', async () => {
    const onreorder = vi.fn();
    render(Harness, { onreorder });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    expect(screen.getByRole('button', { name: 'Up a' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Down c' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Down a' }));
    expect(onreorder).toHaveBeenCalledWith({ keys: ['b', 'a', 'c'], moved: 'a' });
  });

  it('locks every way to move while disabled', async () => {
    const onreorder = vi.fn();
    render(Harness, { onreorder, disabled: true });
    expect(screen.getByTestId('row-a').getAttribute('draggable')).toBe('false');
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Move a' }), { key: 'ArrowDown' });
    expect(onreorder).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Down a' }).hasAttribute('disabled')).toBe(true);
  });
});

/** WP-461: a SortableItem in a host that has its own list (the sidebar's ul > li) takes role presentation. */
describe('SortableItem role', () => {
  it('is a listitem by default and presentation when the host passes it', async () => {
    const { default: Item } = await import('./sortable-item.svelte');
    const { SortableState } = await import('./state.svelte.js');
    const { render: r } = await import('@testing-library/svelte');
    const a = r(Item, { state: new SortableState(), id: 'a', keys: ['a'], onreorder: () => {} });
    expect(a.baseElement.querySelector('[data-sortable-id]')?.getAttribute('role')).toBe('listitem');
    const b = r(Item, {
      state: new SortableState(),
      id: 'b',
      keys: ['b'],
      onreorder: () => {},
      role: 'presentation',
    });
    expect(b.baseElement.querySelector('[data-sortable-id="b"]')?.getAttribute('role')).toBe('presentation');
  });
});
