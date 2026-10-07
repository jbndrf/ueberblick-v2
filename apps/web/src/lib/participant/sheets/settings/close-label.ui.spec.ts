// @vitest-environment jsdom
// WP-790: the sheet's screen-reader close label follows the chosen language, not the compiled base language.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import SettingsSheet from './SettingsSheet.svelte';
import { fakeDevice, memoryStorage } from './fake-device.testing';
import { createDevicePrefs } from './prefs';

afterEach(cleanup);

describe('the close label of the Einstellungen sheet', () => {
  it('re-reads on a language switch', async () => {
    const { device } = fakeDevice([]);
    const props = {
      open: true,
      device,
      locale: 'en' as 'en' | 'de',
      prefs: createDevicePrefs({ storage: memoryStorage(), prefersDark: () => false, deviceLocale: 'de' }),
      online: true,
      taskLabel: (k: string) => k,
      roleLabel: (k: string) => k,
      onjump: vi.fn(),
      onsignout: vi.fn(async () => true),
      onlocale: vi.fn(),
    };
    const view = render(SettingsSheet, props);
    expect(await screen.findByText('Close', { selector: '.sr-only' })).toBeTruthy();
    await view.rerender({ ...props, locale: 'de' });
    expect(await screen.findByText('Schließen', { selector: '.sr-only' })).toBeTruthy();
  });
});
