// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import { setUiLocale } from '../i18n-locale';
import '../components/ui/jsdom-shims.testing';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;

afterEach(() => {
  cleanup();
  setUiLocale(undefined);
});

describe('a language switch while a form is open (WP-828)', () => {
  it('relabels the kit strings (the "required" mark) and keeps what was typed', async () => {
    setUiLocale('de');
    const input = {
      form: { t: { required: true } } as never,
      properties: { t: P('text', { label: { de: 'Titel', en: 'Title' } }) },
    };
    const session = createFormSession(buildFormModel(input), sessionOptions(input, {}, {} as never));
    session.setLocale('de');
    render(FormRenderer, { session, onsubmit: () => {}, oncancel: () => {} });
    await screen.findByText('(Pflichtfeld)');
    (screen.getByRole('textbox') as HTMLInputElement).value = 'x';
    session.set('t', 'Linde');
    setUiLocale('en');
    session.setLocale('en');
    await waitFor(() => expect(screen.getByText('(required)')).toBeTruthy());
    expect(screen.queryByText('(Pflichtfeld)')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Linde');
  });
});
