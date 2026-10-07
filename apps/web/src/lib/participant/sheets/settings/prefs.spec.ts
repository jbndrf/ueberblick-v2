import { describe, expect, it } from 'vitest';
import { memoryStorage } from './fake-device.testing';
import {
  FONT_PX,
  FONT_SIZES,
  PREF_KEYS,
  THEME_MODES,
  applyUiPrefs,
  createDevicePrefs,
  startPrefs,
  type PrefsRoot,
  type UiPrefs,
} from './prefs';

const port = (storage = memoryStorage(), dark = false) =>
  createDevicePrefs({ storage, prefersDark: () => dark, deviceLocale: 'de' });
const root = (): PrefsRoot & { dark: boolean } => {
  const r = {
    dark: false,
    classList: { toggle: (_: string, force: boolean) => void (r.dark = force) },
    style: { fontSize: '' },
  };
  return r;
};

describe('device prefs', () => {
  it('start from the device: system theme, medium text, the device language', () => {
    expect(port().read()).toEqual({ theme: 'light', fontSize: 'medium', locale: 'de' });
    expect(port(memoryStorage(), true).read().theme).toBe('dark');
  });

  it('survive a reload: a new port over the same storage reads what was written', () => {
    const storage = memoryStorage();
    port(storage).write({ theme: 'dark', fontSize: 'xl', locale: 'en' });
    expect(port(storage).read()).toEqual({ theme: 'dark', fontSize: 'xl', locale: 'en' });
  });

  it('the theme key is the one app.html reads before first paint', () => {
    const storage = memoryStorage();
    port(storage).write({ theme: 'dark' });
    expect(storage.getItem('mode-watcher-mode')).toBe('dark');
  });

  it('a damaged stored value falls back to the default, never to a stray string', () => {
    const storage = memoryStorage({
      [PREF_KEYS.fontSize]: '99px',
      [PREF_KEYS.theme]: 'neon',
      [PREF_KEYS.locale]: 'fr',
    });
    expect(port(storage).read()).toEqual({ theme: 'light', fontSize: 'medium', locale: 'de' });
  });

  it('a write changes only the keys it names (property over all value combinations)', () => {
    for (const theme of THEME_MODES.keys)
      for (const fontSize of FONT_SIZES.keys) {
        const storage = memoryStorage();
        const p = port(storage);
        p.write({ theme, fontSize, locale: 'en' });
        p.write({ fontSize: 'small' });
        expect(p.read()).toEqual<UiPrefs>({ theme, fontSize: 'small', locale: 'en' });
      }
  });
});

describe('applying prefs', () => {
  it('sets the dark class and the root font size at once', () => {
    const r = root();
    applyUiPrefs(r, { theme: 'dark', fontSize: 'large' });
    expect(r.dark).toBe(true);
    expect(r.style.fontSize).toBe('18px');
    applyUiPrefs(r, { theme: 'light', fontSize: 'xs' });
    expect(r.dark).toBe(false);
    expect(r.style.fontSize).toBe('12px');
  });

  it('every font size has a root size', () => {
    expect(FONT_SIZES.keys.map((k) => FONT_PX[k])).toEqual(['12px', '14px', '16px', '18px', '20px']);
  });

  it('startPrefs applies what is stored when the app starts', () => {
    const storage = memoryStorage();
    port(storage).write({ theme: 'dark', fontSize: 'xl' });
    const r = root();
    startPrefs(port(storage), r);
    expect(r.dark).toBe(true);
    expect(r.style.fontSize).toBe('20px');
  });
});
