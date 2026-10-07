// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Sheet from './Sheet.svelte';
import StatusBadge from './StatusBadge.svelte';
import { text } from '../testing/snippet';
import { axeViolations } from '../testing/axe';
import { STATUS_KINDS } from '@ueberblick/core/registry';
import { TARGET_SIZE } from '../tokens';

describe('Sheet', () => {
  const props = { title: 'Details', open: true, onclose: () => {}, children: text('Body') };

  it('is a modal dialog named by its title', () => {
    render(Sheet, props);
    const d = screen.getByRole('dialog', { name: 'Details' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Body')).toBeTruthy();
  });

  it('renders nothing while closed', () => {
    render(Sheet, { ...props, open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus into the sheet on open', () => {
    render(Sheet, props);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes without dragging: close button, Escape and backdrop (WCAG 2.5.7)', async () => {
    const onclose = vi.fn();
    const user = userEvent.setup();
    render(Sheet, { ...props, onclose });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('sheet-backdrop'));
    expect(onclose).toHaveBeenCalledTimes(3);
  });

  it('the close button is at least 44 px', () => {
    render(Sheet, props);
    const b = screen.getByRole('button', { name: 'Close' });
    expect(parseFloat(getComputedStyle(b).minHeight)).toBeGreaterThanOrEqual(TARGET_SIZE.other);
  });

  it('traps Tab inside the sheet', async () => {
    const user = userEvent.setup();
    render(Sheet, props);
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to the opener when it closes', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(Sheet, props);
    expect(document.activeElement).not.toBe(opener);
    await rerender({ ...props, open: false });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('has no axe violations', async () => {
    const { baseElement } = render(Sheet, props);
    expect(await axeViolations(baseElement)).toEqual([]);
  });
});

describe('StatusBadge', () => {
  const expected = {
    online: 'Online',
    offline: 'Offline',
    pending: 'Waiting to sync',
    refused: 'Refused',
  } as const;

  it.each(STATUS_KINDS.keys)('%s shows an icon and text, never colour alone', (status) => {
    const { container } = render(StatusBadge, { status });
    expect(screen.getByRole('status').textContent).toContain(expected[status]);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('each status uses a different icon, so shape carries the meaning too', () => {
    const shapes = STATUS_KINDS.keys.map((status) => {
      const { container, unmount } = render(StatusBadge, { status });
      const d = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d')).join('|');
      unmount();
      return d;
    });
    expect(new Set(shapes).size).toBe(STATUS_KINDS.keys.length);
  });

  it('has no axe violations for every status', async () => {
    for (const status of STATUS_KINDS.keys) {
      const { container, unmount } = render(StatusBadge, { status });
      expect(await axeViolations(container)).toEqual([]);
      unmount();
    }
  });
});
