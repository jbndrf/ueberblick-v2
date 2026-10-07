// @vitest-environment jsdom
// WP-734 (v3 FieldRenderer.svelte:696-697): a number property's declared bounds sit on the input as min/max; core still
// enforces them on submit.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import '../components/ui/jsdom-shims.testing';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
afterEach(() => (document.body.innerHTML = ''));

function mount(properties: Record<string, Property>) {
  const input = { form: Object.fromEntries(Object.keys(properties).map((k) => [k, {}])), properties };
  const session = createFormSession(buildFormModel(input), sessionOptions(input, {}));
  render(FormRenderer, { session, onsubmit: vi.fn() });
}

describe('number limits on the input', () => {
  it('a number with bounds renders min and max', () => {
    mount({ hoehe: P('number', { label: 'Höhe', min: 1, max: 40 }) });
    const input = screen.getByLabelText(/Höhe/);
    expect(input.getAttribute('type')).toBe('number');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('40');
  });

  it('an integer with one bound renders only that bound; a number without bounds renders none', () => {
    mount({ stamm: P('integer', { label: 'Stamm', max: 9 }), frei: P('number', { label: 'Frei' }) });
    expect(screen.getByLabelText(/Stamm/).getAttribute('max')).toBe('9');
    expect(screen.getByLabelText(/Stamm/).hasAttribute('min')).toBe(false);
    expect(screen.getByLabelText(/Frei/).hasAttribute('min')).toBe(false);
    expect(screen.getByLabelText(/Frei/).hasAttribute('max')).toBe(false);
  });
});
