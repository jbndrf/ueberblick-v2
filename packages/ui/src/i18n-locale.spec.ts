// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './form/FormRenderer.svelte';
import { buildFormModel } from './form/model';
import { createFormSession } from './form/session';
import { sessionOptions } from './form/form.testing';
import './components/ui/jsdom-shims.testing';
import { setUiLocale } from './i18n-locale';
import { m } from './paraglide/messages.js';

afterEach(() => setUiLocale(undefined));

const input = {
  form: { s: {} },
  properties: { s: { type: 'select', label: 'Wahl', options: { a: 'A' } } as unknown as Property },
} as Parameters<typeof buildFormModel>[0];
const session = () => createFormSession(buildFormModel(input), sessionOptions(input));
const props = () => ({ session: session(), onsubmit: () => undefined });

describe('setUiLocale (WP-394)', () => {
  it('a kit select shows the language the app set: de, then en', () => {
    setUiLocale('de');
    const de = render(FormRenderer, props());
    expect(de.container.textContent).toContain('Auswählen');
    expect(de.container.textContent).not.toContain('Choose');
    de.unmount();
    setUiLocale('en');
    const en = render(FormRenderer, props());
    expect(en.container.textContent).toContain('Choose');
    expect(en.container.textContent).not.toContain('Auswählen');
  });

  it('undefined goes back to the runtime default (en)', () => {
    setUiLocale('de');
    expect(m.form_choose()).toBe('Auswählen');
    setUiLocale(undefined);
    expect(m.form_choose()).toBe('Choose');
  });
});
