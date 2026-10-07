// @vitest-environment jsdom
// WP-643: v3's form chrome: footer icons, the submitting state, "Create Entry" for a form with no fields, half-width
// columns (also on a phone), email as type=email.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Property } from '@ueberblick/core/model';
import '../components/ui/jsdom-shims.testing';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import { axeViolations } from '../testing/axe';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
type Form = Parameters<typeof buildFormModel>[0]['form'];

function setup(form: Form, props: Record<string, Property>, extra: Record<string, unknown> = {}) {
  const input = { form, properties: props };
  const session = createFormSession(buildFormModel(input), sessionOptions(input));
  const onsubmit = vi.fn();
  const view = render(FormRenderer, { session, onsubmit, ...extra });
  return { session, onsubmit, ...view };
}
afterEach(() => {
  document.body.style.pointerEvents = '';
});
const icons = (el: HTMLElement) => [...el.querySelectorAll('svg')].map((s) => s.getAttribute('class') ?? '');

describe('footer (v3 FormFillTool.svelte:407-445)', () => {
  const props = { a: P('text', { label: 'First' }), b: P('text', { label: 'Second' }) };
  const form: Form = { a: {}, b: { page: {} } };

  it('Cancel on the first page, Next with ChevronRight; Back with ChevronLeft; Submit with Send', async () => {
    setup(form, props, { oncancel: vi.fn() });
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(icons(next).join(' ')).toContain('lucide-chevron-right');
    await user.click(next);
    const back = screen.getByRole('button', { name: 'Back' });
    expect(icons(back).join(' ')).toContain('lucide-chevron-left');
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(icons(submit).join(' ')).toContain('lucide-send');
  });

  it('a step that is not the last (continues) draws the chevron on its single page, not the paper plane (WP-855)', () => {
    setup({ a: {} }, { a: P('text', { label: 'First' }) }, { submitLabel: 'Weiter', continues: true });
    const btn = screen.getByRole('button', { name: 'Weiter' });
    expect(icons(btn).join(' ')).toContain('lucide-chevron-right');
    expect(icons(btn).join(' ')).not.toContain('lucide-send');
  });

  it('while submitting: a Loader and "Submitting…", every button disabled, a second tap does nothing', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((r) => (release = r));
    const onsubmit = vi.fn(() => pending);
    setup({ a: {} }, { a: P('text', { label: 'First' }) }, { onsubmit, oncancel: vi.fn() });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const busy = await screen.findByRole('button', { name: /Submitting/ });
    expect(icons(busy).join(' ')).toContain('animate-spin');
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(busy);
    expect(onsubmit).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy());
  });

  it('a form without fields says so and the button reads "Create Entry"', () => {
    setup({}, {});
    expect(screen.getByText('No additional information required.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Entry' })).toBeTruthy();
  });

  it('is sticky at the bottom edge and axe clean', async () => {
    const { container } = setup(form, props, { oncancel: vi.fn() });
    expect(container.querySelector('[data-testid="form-footer"]')?.className).toContain('sticky bottom-0');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('columns (v3 getColumnClass, FormRenderer.svelte:131-150)', () => {
  const props = {
    a: P('text', { label: 'Left one' }),
    b: P('text', { label: 'Right one' }),
    c: P('text', { label: 'Full one' }),
    d: P('text', { label: 'Left alone' }),
  };
  // the width and line are the form entry's (A-049)
  const form: Form = {
    a: { column: 'left', row: 1 },
    b: { column: 'right', row: 1 },
    c: {},
    d: { column: 'left', row: 2 },
  };

  it('left and right of one row sit side by side at half width; others are full width, one per line', () => {
    const { container } = setup(form, props);
    const cell = (label: RegExp) => screen.getByLabelText(label).closest('[data-column]') as HTMLElement;
    expect(cell(/Left one/).dataset['column']).toBe('left');
    expect(cell(/Left one/).className).toContain('w-[calc(50%-0.5rem)]');
    expect(cell(/Right one/).className).toContain('w-[calc(50%-0.5rem)]');
    expect(cell(/Right one/).className).toContain('ml-auto');
    expect(cell(/Left one/).parentElement).toBe(cell(/Right one/).parentElement);
    expect(cell(/Full one/).parentElement).not.toBe(cell(/Left one/).parentElement);
    expect(cell(/Left alone/).parentElement).not.toBe(cell(/Left one/).parentElement);
    expect(container.querySelectorAll('[data-column]').length).toBe(4);
  });

  it('without display settings every field is a full-width line', () => {
    setup({ a: {} }, { a: P('text', { label: 'Plain' }) });
    expect((screen.getByLabelText(/Plain/).closest('[data-column]') as HTMLElement).dataset['column']).toBe(
      'full',
    );
  });
});

describe('email', () => {
  it('a text field with the email appearance is type=email', () => {
    setup(
      { a: { appearance: 'email' }, b: {} },
      { a: P('text', { label: 'Mail' }), b: P('text', { label: 'Name' }) },
    );
    expect((screen.getByLabelText(/Mail/) as HTMLInputElement).type).toBe('email');
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).type).toBe('text');
  });
});
