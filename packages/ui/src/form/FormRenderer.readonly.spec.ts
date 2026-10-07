// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import '../components/ui/jsdom-shims.testing';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
type Form = Parameters<typeof buildFormModel>[0]['form'];

const props = {
  t: P('text', { label: 'Text' }),
  b: P('boolean', { label: 'Flag' }),
  s: P('select', { label: 'Pick', options: { a: 'Alpha', b: 'Beta' } }),
  m: P('multiselect', { label: 'Many', options: { x: 'X', y: 'Y' } }),
  u: P('text', { label: 'Locked' }),
};

function setup(readonly: boolean, form: Form, initial: Record<string, unknown>, extra = {}) {
  const input = { form, properties: props };
  const session = createFormSession(buildFormModel(input), sessionOptions(input, {}, { initial } as never));
  const onsubmit = vi.fn();
  render(FormRenderer, {
    session,
    onsubmit,
    oncancel: () => {},
    ...(readonly ? { readonly } : {}),
    ...extra,
  });
  return { session, onsubmit };
}

const one: Form = { t: { required: true }, b: {}, s: {}, m: {} } as Form;

describe('FormRenderer readonly (the record view)', () => {
  it('shows the values with aria-readonly and never disabled', () => {
    setup(true, one, { t: 'hello', b: true, s: 'a', m: ['x', 'y'] });
    const text = screen.getByLabelText(/Text/) as HTMLInputElement;
    expect(text.value).toBe('hello');
    expect(text.getAttribute('aria-readonly')).toBe('true');
    expect(text.readOnly).toBe(true);
    expect(text.disabled).toBe(false);
    expect((screen.getByLabelText('Pick') as HTMLInputElement).value).toBe('Alpha');
    expect((screen.getByLabelText('Many') as HTMLInputElement).value).toBe('X, Y');
    expect(screen.getByLabelText('Pick').getAttribute('aria-readonly')).toBe('true');
    const box = screen.getByRole('checkbox');
    expect(box.getAttribute('aria-readonly')).toBe('true');
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect((box as HTMLButtonElement).disabled).toBe(false);
  });

  it('has no submit, cancel, error summary or required mark; typing and clicking change nothing', async () => {
    const { session, onsubmit } = setup(true, one, { t: '', b: false });
    expect(screen.queryByRole('button', { name: /Absenden|Submit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Abbrechen|Cancel/i })).toBeNull();
    expect(screen.queryByTestId('form-footer')).toBeNull();
    expect(document.querySelector('[aria-hidden="true"].text-destructive')).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Text/), 'x{Enter}');
    await user.click(screen.getByRole('checkbox'));
    expect(onsubmit).not.toHaveBeenCalled();
    expect(session.get('b')).toBeFalsy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps page navigation on a form with several pages', async () => {
    const paged = { t: {}, b: { page: {} } } as unknown as Form;
    setup(true, paged, { t: 'a', b: true });
    const user = userEvent.setup();
    expect((screen.getByRole('button', { name: /Weiter|Next/ }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: /Weiter|Next/ }));
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Weiter|Next/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Absenden|Submit/i })).toBeNull();
  });

  it('without the flag the form is the editable one: disabled stays for a readonly field, submit is drawn', () => {
    const input = { form: { t: {}, u: { readonly: true } } as unknown as Form, properties: props };
    const session = createFormSession(buildFormModel(input), sessionOptions(input, {}, {}));
    render(FormRenderer, { session, onsubmit: () => {} });
    expect((screen.getByLabelText('Locked') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByLabelText('Locked').getAttribute('aria-readonly')).toBeNull();
    expect(screen.getByLabelText('Text').getAttribute('readonly')).toBeNull();
    expect(screen.getByRole('button', { name: /Absenden|Submit/i })).toBeTruthy();
  });
});
