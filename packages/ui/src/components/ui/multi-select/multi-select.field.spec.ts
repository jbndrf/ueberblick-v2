// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../jsdom-shims.testing';
import { axeViolations } from '../../../testing/axe';
import MultiSelect from './multi-select.svelte';
import type { MultiSelectOption } from './types';

function viewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}

beforeEach(() => viewport(1280));
afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('MultiSelect as a form field (WP-642)', () => {
  const options: MultiSelectOption[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('carries the field id and described-by; invalid turns the border red', () => {
    render(MultiSelect, { options, id: 'pick', describedby: 'pick-error', invalid: true });
    const trigger = screen.getByRole('button');
    expect(trigger.id).toBe('pick');
    expect(trigger.getAttribute('aria-describedby')).toBe('pick-error');
    expect(trigger.className).toContain('border-destructive');
  });

  it('is not red when valid', () => {
    render(MultiSelect, { options, id: 'pick' });
    expect(screen.getByRole('button').className).not.toContain('border-destructive');
  });

  it('property: the rows shown are exactly the options whose label or description contain the query', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 6 }),
        fc.string({ maxLength: 2 }),
        async (labels, query) => {
          const opts = labels.map((label, i) => ({ value: String(i), label }));
          const { container, unmount } = render(MultiSelect, { options: opts });
          try {
            // Scoped to this render: the trigger is the only element with aria-haspopup in its own container.
            const trigger = container.querySelector<HTMLElement>('[aria-haspopup]');
            if (!trigger) throw new Error('no trigger');
            await fireEvent.click(trigger);
            const box = within(document.body).getByRole('textbox');
            if (query !== '') await fireEvent.input(box, { target: { value: query } });
            const typed = (box as HTMLInputElement).value.toLowerCase();
            const expected = opts.filter((o) => o.label.toLowerCase().includes(typed)).length;
            expect(within(document.body).queryAllByRole('option')).toHaveLength(expected);
            await fireEvent.keyDown(box, { key: 'Escape' });
          } finally {
            unmount();
            document.body.innerHTML = '';
            document.body.style.overflow = '';
          }
        },
      ),
      { numRuns: 50 },
    );
  }, 60_000);
});

describe('MultiSelect phone rows carry their state (WCAG 4.1.2)', () => {
  const options: MultiSelectOption[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];
  beforeEach(() => viewport(390));

  it('single select: radios in a radiogroup, the picked one checked', async () => {
    render(MultiSelect, { options, selected: ['b'], singleSelect: true });
    await userEvent.setup().click(screen.getByRole('button'));
    const group = screen.getByRole('radiogroup', { name: 'Options' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });

  it('multi select: checkboxes in a group that toggle', async () => {
    const user = userEvent.setup();
    render(MultiSelect, { options });
    await user.click(screen.getByRole('button'));
    const group = screen.getByRole('group', { name: 'Options' });
    const [first] = within(group).getAllByRole('checkbox');
    expect(first?.getAttribute('aria-checked')).toBe('false');
    if (first) await user.click(first);
    expect(within(group).getAllByRole('checkbox')[0]?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('MultiSelect axe, WCAG 2.1 A and AA', () => {
  const options: MultiSelectOption[] = [
    { value: 'a', label: 'Alpha', description: 'First' },
    { value: 'b', label: 'Beta' },
  ];
  // A portalled layer sits outside any landmark by design; the page-level `region` rule does not apply to it.
  const axeBody = async () => (await axeViolations(document.body)).filter((v) => !v.startsWith('region:'));

  it.each([
    ['phone dialog', 390, ['a']],
    ['desktop popover', 1280, ['a', 'b']],
  ] as const)('the %s is clean when open, single and multi', async (_n, width, picked) => {
    viewport(width);
    const user = userEvent.setup();
    for (const singleSelect of [true, false]) {
      const { unmount } = render(MultiSelect, { options, selected: [...picked], singleSelect });
      await user.click(screen.getByRole('button', { name: /Alpha|selected/ }));
      expect(await axeBody()).toEqual([]);
      unmount();
      document.body.innerHTML = '';
      document.body.style.overflow = '';
    }
  });
});
