// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Property } from '@ueberblick/core/model';
import FormRenderer from './FormRenderer.svelte';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import { localizedShown, localizedWith } from './localized';
import '../components/ui/jsdom-shims.testing';
import type { Json } from './contract';

const props = { titel: { type: 'localized_text', label: 'Titel' } as unknown as Property };
const input = { form: { titel: {} }, properties: props };

function open(self: Record<string, Json> | undefined, locale: string) {
  const session = createFormSession(
    buildFormModel(input),
    sessionOptions(input, undefined, { locale, ...(self ? { initial: self } : {}) }),
  );
  render(FormRenderer, { session, onsubmit: () => undefined });
  return session;
}

describe('localizedWith / localizedShown', () => {
  it('writes only the locale and keeps the others', () => {
    expect(localizedWith({ de: 'Eiche' }, 'en', 'Oak')).toEqual({ de: 'Eiche', en: 'Oak' });
    expect(localizedWith({ de: 'Eiche', en: 'Oak' }, 'en', 'Elm')).toEqual({ de: 'Eiche', en: 'Elm' });
  });
  it('clearing removes only that locale; nothing left is null', () => {
    expect(localizedWith({ de: 'Eiche', en: 'Oak' }, 'en', '')).toEqual({ de: 'Eiche' });
    expect(localizedWith({ en: 'Oak' }, 'en', '')).toBeNull();
    expect(localizedWith(undefined, 'de', '')).toBeNull();
  });
  it('shows the read view chain', () => {
    expect(localizedShown({ de: 'Eiche', en: 'Oak' }, 'en')).toBe('Oak');
    expect(localizedShown({ de: 'Eiche' }, 'en-GB')).toBe('Eiche');
    expect(localizedShown({ en: 'Oak', de: 'Eiche' }, 'en-GB')).toBe('Oak');
    expect(localizedShown(undefined, 'de')).toBe('');
  });
});

describe('a localized_text field in the form', () => {
  it('typing writes a localized value that core.form accepts', async () => {
    const session = open(undefined, 'de');
    await userEvent.setup().type(screen.getByLabelText('Titel'), 'Eiche');
    expect(session.get('titel')).toEqual({ de: 'Eiche' });
    expect(session.validateAll()).toEqual([]);
    expect(session.submitValues()).toEqual({ titel: { de: 'Eiche' } });
  });
  it('keeps the other locales and shows the current one', async () => {
    const session = open({ titel: { de: 'Eiche', en: 'Oak' } }, 'en');
    const field = screen.getByLabelText('Titel') as HTMLInputElement;
    expect(field.value).toBe('Oak');
    await userEvent.setup().type(field, 's');
    expect(session.get('titel')).toEqual({ de: 'Eiche', en: 'Oaks' });
    expect(session.validateAll()).toEqual([]);
  });
  it('clearing the field removes only its locale', async () => {
    const session = open({ titel: { de: 'Eiche', en: 'Oak' } }, 'en');
    await userEvent.setup().clear(screen.getByLabelText('Titel'));
    expect(session.get('titel')).toEqual({ de: 'Eiche' });
  });
  it('falls back like the read view when the locale is missing', () => {
    open({ titel: { de: 'Eiche' } }, 'en');
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('Eiche');
  });
});
