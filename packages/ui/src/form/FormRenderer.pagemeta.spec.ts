// @vitest-environment jsdom
// WP-672: page title and description (v3 FormPage) and the placeholder (v3 field.placeholder).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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

function setup(form: Form, props: Record<string, Property>) {
  const input = { form, properties: props };
  const session = createFormSession(buildFormModel(input), sessionOptions(input, undefined, {}));
  return render(FormRenderer, { session, onsubmit: vi.fn() });
}

const props = {
  a: P('text', { label: 'First' }),
  b: P('text', { label: 'Second' }),
  c: P('text', { label: 'Third' }),
};
const form: Form = {
  a: { placeholder: { de: 'Name', en: 'Your name' } },
  b: { page: { label: { en: 'Findings', de: 'Befund' }, hint: { en: 'Describe what you see.' } } },
  c: { page: {} },
};

describe('page title, description and placeholder', () => {
  it('the tab says the title; a page without one keeps "Page n"', () => {
    setup(form, props);
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      'Page 1',
      'Findings',
      'Page 3',
    ]);
  });

  it('the page heading and its description are drawn above the fields', async () => {
    setup(form, props);
    const user = userEvent.setup();
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /Findings/ }));
    expect(screen.getByRole('heading', { level: 4, name: 'Findings' })).toBeTruthy();
    expect(screen.getByText('Describe what you see.')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /Page 3/ }));
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
  });

  it('a single page with a title shows heading and description and no tabs', () => {
    setup({ a: { page: { label: 'Only', hint: 'Intro' } } }, { a: props.a });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 4, name: 'Only' })).toBeTruthy();
    expect(screen.getByText('Intro')).toBeTruthy();
  });

  it('the placeholder shows in an empty input', () => {
    setup(form, props);
    expect((screen.getByLabelText(/First/) as HTMLInputElement).placeholder).toBe('Your name');
  });

  it('the placeholder shows in a textarea and a number input', () => {
    setup(
      { t: { appearance: 'multiline', placeholder: 'Long' }, n: { placeholder: '0' } },
      { t: P('text', { label: 'Text' }), n: P('number', { label: 'Num' }) },
    );
    expect((screen.getByLabelText(/Text/) as HTMLTextAreaElement).placeholder).toBe('Long');
    expect((screen.getByLabelText(/Num/) as HTMLInputElement).placeholder).toBe('0');
  });

  it('an e-mail field shows an example address unless it has its own placeholder', () => {
    setup(
      { a: { appearance: 'email' }, b: { appearance: 'email', placeholder: 'mail' } },
      { a: P('text', { label: 'Mail A' }), b: P('text', { label: 'Mail B' }) },
    );
    expect((screen.getByLabelText(/Mail A/) as HTMLInputElement).placeholder).toBe('email@example.com');
    expect((screen.getByLabelText(/Mail B/) as HTMLInputElement).placeholder).toBe('mail');
  });

  it('has no axe violations with titles', async () => {
    const { container } = setup(form, props);
    expect(await axeViolations(container)).toEqual([]);
  });
});
