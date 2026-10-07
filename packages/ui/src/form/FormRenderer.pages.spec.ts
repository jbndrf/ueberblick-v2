// @vitest-environment jsdom
// WP-624: v3's task form: page tabs with "{count} fehlen", the clearing guard, field chrome.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Property } from '@ueberblick/core/model';
import '../components/ui/jsdom-shims.testing';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import { axeViolations } from '../testing/axe';
import type { Json, SessionOptions } from './contract';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
type Form = Parameters<typeof buildFormModel>[0]['form'];
type Opts = Partial<SessionOptions> & { self?: Record<string, Json> };

function setup(form: Form, props: Record<string, Property>, opts: Opts = {}, extra = {}) {
  const { self, ...rest } = opts;
  const input = { form, properties: props };
  const session = createFormSession(buildFormModel(input), sessionOptions(input, self, rest));
  const onsubmit = vi.fn();
  const view = render(FormRenderer, { session, onsubmit, ...extra });
  return { session, onsubmit, ...view };
}

// bits-ui locks pointer events while a dialog is open and releases them a tick later; jsdom has no layout to wait on.
afterEach(() => {
  document.body.style.pointerEvents = '';
});

describe('page tabs', () => {
  const props = {
    a: P('text', { label: 'First' }),
    b: P('text', { label: 'Second' }),
    c: P('text', { label: 'Third' }),
  };
  const form: Form = {
    a: { required: true },
    b: { page: {}, required: true },
    c: { page: {} },
  };

  it('shows one tab per page, Next never blocks, Back keeps the values', async () => {
    const { onsubmit } = setup(form, props);
    const user = userEvent.setup();
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      'Page 1',
      'Page 2',
      'Page 3',
    ]);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(screen.getByLabelText(/Second/), 'two');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.type(screen.getByLabelText(/First/), 'one');
    await user.click(screen.getByRole('tab', { name: /Page 2/ }));
    expect((screen.getByLabelText(/Second/) as HTMLInputElement).value).toBe('two');
    await user.click(screen.getByRole('tab', { name: /Page 3/ }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onsubmit).toHaveBeenCalledWith({ a: 'one', b: 'two' });
  });

  it('Submit validates every page, jumps to the first page with an error and counts what is missing', async () => {
    const { onsubmit } = setup(form, props);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Page 3/ }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onsubmit).not.toHaveBeenCalled();
    const first = screen.getByRole('tab', { name: /Page 1/ });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(within(first).getByLabelText('1 missing on this page')).toBeTruthy();
    expect(
      within(screen.getByRole('tab', { name: /Page 2/ })).getByLabelText('1 missing on this page'),
    ).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /Page 3/ })).queryByLabelText(/missing/)).toBeNull();
  });

  it('the count follows the edits', async () => {
    setup(form, props);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Page 3/ }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getByRole('tab', { name: /Page 1/ }));
    await user.type(screen.getByLabelText(/First/), 'x');
    expect(within(screen.getByRole('tab', { name: /Page 1/ })).queryByLabelText(/missing/)).toBeNull();
  });

  it('has no tab strip for a single page', () => {
    setup({ a: {} }, { a: P('text', { label: 'First' }) });
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('is axe clean with the tab strip and counts', async () => {
    const { container } = setup(form, props);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Page 3/ }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('clearing guard', () => {
  const props = { v: P('integer', { label: 'Vitality' }), foto: P('text', { label: 'Finding' }) };
  const form: Form = { v: {}, foto: { relevant: 'form.v >= 3' } };

  it('appears when a hidden field holds a stored value; confirm submits null, cancel stays', async () => {
    const { onsubmit } = setup(form, props, { self: { foto: 'old' }, initial: { v: 1 } });
    // bits-ui releases the page's pointer lock a tick after the dialog closes; jsdom has no layout to wait on.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Fields will be cleared')).toBeTruthy();
    expect(within(dialog).getByText('Finding')).toBeTruthy();
    expect(onsubmit).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onsubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Clear & save' }),
    );
    expect(onsubmit).toHaveBeenCalledWith({ v: 1, foto: null });
  });

  it('does not appear when nothing stored would be cleared', async () => {
    const { onsubmit } = setup(form, props, { initial: { v: 1 } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onsubmit).toHaveBeenCalledWith({ v: 1 });
  });

  it('does not open while the form still has errors', async () => {
    const { onsubmit } = setup({ ...form, v: { required: true } }, props, { self: { foto: 'old' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onsubmit).not.toHaveBeenCalled();
  });
});

describe('field chrome', () => {
  it('marks required fields with a star, shows help text and draws a textarea for multiline', () => {
    setup(
      { t: { required: true, appearance: 'multiline' }, n: {} },
      { t: P('text', { label: 'Note' }), n: P('integer', { label: 'Count', description: 'How many?' }) },
    );
    expect(screen.getByLabelText(/Note/).tagName).toBe('TEXTAREA');
    expect(screen.getByText('*')).toBeTruthy();
    expect(screen.getByText('How many?')).toBeTruthy();
  });

  it('the footer shows Cancel on the first page when the caller can cancel', async () => {
    const oncancel = vi.fn();
    setup({ a: {} }, { a: P('text', { label: 'First' }) }, {}, { oncancel });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(oncancel).toHaveBeenCalled();
  });

  it('a form without fields says so and still submits', async () => {
    const { onsubmit } = setup({}, {});
    expect(screen.getByText('No additional information required.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create Entry' }));
    expect(onsubmit).toHaveBeenCalledWith({});
  });
});
