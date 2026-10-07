// @vitest-environment jsdom
// WP-713: the kit's own strings (the close button of a dialog or sheet) follow the language the person chose in the
// app, not the compiled base language.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { setUiLocale } from '@ueberblick/ui';
import SheetHost from './SheetHost.svelte';
import CloseProbe from './testing/CloseProbe.svelte';

afterEach(() => {
  cleanup();
  setUiLocale(undefined);
});

const mount = (locale: 'de' | 'en') =>
  render(SheetHost, {
    open: ['settings'],
    ctx: { locale } as never,
    featureId: null,
    onclose: () => undefined,
    registry: () => async () => ({ default: CloseProbe as never }),
  });

describe('SheetHost sets the language of the kit', () => {
  it.each([
    ['de', 'Schließen'],
    ['en', 'Close'],
  ] as const)('the close button of a dialog reads %s', async (locale, name) => {
    mount(locale);
    expect(await screen.findByRole('button', { name })).toBeTruthy();
  });
});
