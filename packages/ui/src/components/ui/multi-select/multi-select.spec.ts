// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../jsdom-shims.testing';
import MultiSelect from './multi-select.svelte';
import type { MultiSelectOption } from './types';

const options: MultiSelectOption[] = [
  { value: 'admin', label: 'Admin', description: 'Full access' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}

const highlighted = () =>
  screen.getAllByRole('option').map((o) => o.getAttribute('data-highlighted') === 'true');

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe.each([
  ['phone 390px', 390],
  ['desktop 1280px', 1280],
])('MultiSelect at %s', (_name, width) => {
  beforeEach(() => setViewport(width));
  const mobile = width < 768;

  it('opens a full-screen dialog on phones and a dropdown on desktop, with search', async () => {
    const user = userEvent.setup();
    render(MultiSelect, { options, selected: [] });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    if (mobile) {
      const dialog = await screen.findByRole('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    } else {
      expect(await screen.findByRole('listbox')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    await user.type(screen.getByRole('textbox'), 'edi');
    expect(screen.queryByText('Admin')).toBeNull();
    expect(screen.getByText('Editor')).toBeTruthy();
  });

  it('searches the description too', async () => {
    const user = userEvent.setup();
    render(MultiSelect, { options, selected: [] });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    await user.type(screen.getByRole('textbox'), 'full');
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.queryByText('Editor')).toBeNull();
  });

  it('create by typing calls onCreate and selects the new option', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async (label: string) => ({ value: 'new', label }));
    const onSelectedChange = vi.fn();
    render(MultiSelect, { options, selected: [], allowCreate: true, onCreate, onSelectedChange });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    await user.type(screen.getByRole('textbox'), 'Boss');
    expect(screen.getByText('Create "Boss"')).toBeTruthy();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Boss'));
    await waitFor(() => expect(onSelectedChange).toHaveBeenLastCalledWith(['new']));
  });

  it('offers no create row for an exact match', async () => {
    const user = userEvent.setup();
    render(MultiSelect, { options, selected: [], allowCreate: true, onCreate: vi.fn() });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    await user.type(screen.getByRole('textbox'), 'editor');
    expect(screen.queryByText(/Create/)).toBeNull();
  });

  it('single-select picks one option and closes', async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    render(MultiSelect, { options, selected: [], singleSelect: true, onSelectedChange });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    await user.click(screen.getByText('Viewer'));
    expect(onSelectedChange).toHaveBeenLastCalledWith(['viewer']);
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('multi-select toggles; badges carry remove buttons', async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    render(MultiSelect, { options, selected: ['admin'], onSelectedChange });
    await user.click(screen.getByRole('button', { name: 'Admin' }));
    await user.click(screen.getByText('Editor'));
    expect(onSelectedChange).toHaveBeenLastCalledWith(['admin', 'editor']);
    await user.click(screen.getAllByRole('button', { name: 'Remove Editor' })[0] as HTMLElement);
    expect(onSelectedChange).toHaveBeenLastCalledWith(['admin']);
  });

  it('Escape closes', async () => {
    const user = userEvent.setup();
    render(MultiSelect, { options, selected: [] });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    await screen.findByRole('textbox');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('shows the empty label when nothing matches', async () => {
    const user = userEvent.setup();
    render(MultiSelect, { options, selected: [] });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    await user.type(screen.getByRole('textbox'), 'zzz');
    expect(screen.getByText('No options found')).toBeTruthy();
  });
});

describe('MultiSelect phone specifics', () => {
  beforeEach(() => setViewport(390));

  it('locks body scroll while the dialog is open and sizes it to the visual viewport', async () => {
    const vv = Object.assign(new EventTarget(), { height: 500 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    const user = userEvent.setup();
    render(MultiSelect, { options, selected: [] });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    const dialog = await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');
    expect(dialog.getAttribute('style')).toContain('height: 400px');
    vv.height = 300;
    vv.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(dialog.getAttribute('style')).toContain('height: 240px'));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.body.style.overflow).toBe('');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  });

  it('Done shows the count', async () => {
    const user = userEvent.setup();
    render(MultiSelect, { options, selected: ['admin', 'editor'] });
    await user.click(screen.getByRole('button', { name: /Admin/ }));
    expect(await screen.findByRole('button', { name: 'Done (2)' })).toBeTruthy();
  });
});

describe('MultiSelect desktop', () => {
  beforeEach(() => setViewport(1280));

  it('arrow keys move the highlight, Enter toggles the highlighted option', async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    render(MultiSelect, { options, selected: [], onSelectedChange });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    await screen.findByRole('listbox');
    const search = screen.getByRole('textbox');
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(highlighted()).toEqual([false, true, false]);
    await fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(highlighted()).toEqual([true, false, false]);
    await fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(highlighted()).toEqual([false, false, true]);
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelectedChange).toHaveBeenLastCalledWith(['editor']);
  });

  it('Backspace in an empty search removes the last badge', async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    render(MultiSelect, { options, selected: ['admin', 'editor'], onSelectedChange });
    await user.click(screen.getByRole('button', { name: /Admin/ }));
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Backspace' });
    expect(onSelectedChange).toHaveBeenLastCalledWith(['admin']);
  });

  it('the dropdown is portalled to the body', async () => {
    const user = userEvent.setup();
    const { container } = render(MultiSelect, { options, selected: [] });
    await user.click(screen.getByRole('button', { name: /Select options/ }));
    const list = await screen.findByRole('listbox');
    expect(container.contains(list)).toBe(false);
    expect(document.body.contains(list)).toBe(true);
  });
});
