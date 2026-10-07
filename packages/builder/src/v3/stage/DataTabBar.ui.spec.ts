// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DataTabBar from './DataTabBar.svelte';

const noop = (): void => undefined;

describe('DataTabBar roles', () => {
  it('the tablist holds only tabs; the add button sits beside it', () => {
    render(DataTabBar, {
      t: (k: string) => k,
      names: ['a', 'b'],
      active: 'a',
      label: (n: string) => n,
      isCustom: false,
      confirming: false,
      dropping: false,
      onactivate: noop,
      onadd: noop,
      onrename: noop,
      onaskdelete: noop,
      onremove: noop,
      oncancel: noop,
    });
    const list = screen.getByRole('tablist');
    expect(list.children.length).toBe(2);
    for (const c of Array.from(list.children)) expect(c.getAttribute('role')).toBe('tab');
    expect(list.contains(screen.getByRole('button', { name: 'stage_tab_add' }))).toBe(false);
  });
});
