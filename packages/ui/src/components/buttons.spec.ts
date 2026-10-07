// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Button from './Button.svelte';
import IconButton from './IconButton.svelte';
import { iconClose } from '../icons';
import { text } from '../testing/snippet';
import { axeViolations } from '../testing/axe';
import { TARGET_SIZE } from '../tokens';

const minHeight = (el: HTMLElement) => parseFloat(getComputedStyle(el).minHeight);
const minWidth = (el: HTMLElement) => parseFloat(getComputedStyle(el).minWidth);

describe('Button', () => {
  it('is a real button with a visible label, type button by default', () => {
    render(Button, { children: text('Save') });
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.getAttribute('type')).toBe('button');
  });

  it('activates with click, Enter and Space', async () => {
    const onclick = vi.fn();
    const user = userEvent.setup();
    render(Button, { children: text('Go'), onclick });
    await user.click(screen.getByRole('button'));
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onclick).toHaveBeenCalledTimes(3);
  });

  it('loading: announces busy, shows a status text and ignores clicks', async () => {
    const onclick = vi.fn();
    const user = userEvent.setup();
    render(Button, { children: text('Save'), loading: true, onclick });
    const b = screen.getByRole('button');
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.textContent).toContain('Loading');
    await user.click(b);
    expect(onclick).not.toHaveBeenCalled();
  });

  it('disabled buttons cannot be activated', async () => {
    const onclick = vi.fn();
    render(Button, { children: text('X'), disabled: true, onclick });
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onclick).not.toHaveBeenCalled();
  });

  it.each([
    ['primary', TARGET_SIZE.primary],
    ['danger', TARGET_SIZE.primary],
    ['secondary', TARGET_SIZE.other],
  ] as const)('%s target is at least %s px high and wide', (variant, px) => {
    render(Button, { children: text('A'), variant });
    const b = screen.getByRole('button');
    expect(b.dataset['variant']).toBe(variant);
    expect(minHeight(b)).toBeGreaterThanOrEqual(px);
    expect(minWidth(b)).toBeGreaterThanOrEqual(px);
  });

  it('has no axe violations in any variant or state', async () => {
    const { container } = render(Button, { children: text('Save'), variant: 'danger', loading: true });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('IconButton', () => {
  it('is named by its label and hides the icon from assistive tech', () => {
    render(IconButton, { icon: iconClose, label: 'Close panel' });
    const b = screen.getByRole('button', { name: 'Close panel' });
    expect(b.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('activates by keyboard and meets the 44 px target', async () => {
    const onclick = vi.fn();
    const user = userEvent.setup();
    render(IconButton, { icon: iconClose, label: 'Close', onclick });
    const b = screen.getByRole('button');
    b.focus();
    await user.keyboard('{Enter}');
    expect(onclick).toHaveBeenCalledOnce();
    expect(minHeight(b)).toBeGreaterThanOrEqual(TARGET_SIZE.other);
    expect(minWidth(b)).toBeGreaterThanOrEqual(TARGET_SIZE.other);
  });

  it('has no axe violations', async () => {
    const { container } = render(IconButton, { icon: iconClose, label: 'Close' });
    expect(await axeViolations(container)).toEqual([]);
  });
});
