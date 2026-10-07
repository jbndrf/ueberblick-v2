/**
 * The participant's own look of the app: theme, font size and language (v3 Optionen: `theme-toggle-inline`,
 * `font-size-inline`, `language-selector-inline`). They are personal, not part of any run.
 *
 * Seam (WP-612): the personal preference record on the server replaces `createDevicePrefs` behind the same
 * `PrefsPort`; no component changes. Until then the values sit in device storage under keys that survive a reload.
 * The theme key is the one `app.html` reads before first paint, so a stored theme shows without a flash.
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core/registry';
import type { StoragePort } from '../../drafts';
import type { Locale } from '../../messages';
import { LOCALE_KEY } from '../../login/locale';

export const THEME_MODES = defineRegistry([
  { key: 'light', description: 'Light surfaces.' },
  { key: 'dark', description: 'Dark surfaces (the `dark` class on the document root).' },
] as const);
export type ThemeMode = KeyOf<typeof THEME_MODES>;

export const FONT_SIZES = defineRegistry([
  { key: 'xs', description: 'Extra small, 12 px root.' },
  { key: 'small', description: 'Small, 14 px root.' },
  { key: 'medium', description: 'Medium, 16 px root (the default).' },
  { key: 'large', description: 'Large, 18 px root.' },
  { key: 'xl', description: 'Extra large, 20 px root.' },
] as const);
export type FontSize = KeyOf<typeof FONT_SIZES>;

/** The root font size per step, as v3 (`font-size.svelte.ts:5-11`). */
export const FONT_PX: Readonly<Record<FontSize, string>> = {
  xs: '12px',
  small: '14px',
  medium: '16px',
  large: '18px',
  xl: '20px',
};

export const LOCALES = defineRegistry([
  { key: 'de', description: 'German, the default.' },
  { key: 'en', description: 'English.' },
] as const);

export interface UiPrefs {
  readonly theme: ThemeMode;
  readonly fontSize: FontSize;
  readonly locale: Locale;
}

export interface PrefsPort {
  read(): UiPrefs;
  /** Persists the change; a storage that refuses throws, so the sheet never shows a setting that is not kept. */
  write(patch: Partial<UiPrefs>): void;
}

export const PREF_KEYS = {
  theme: 'mode-watcher-mode',
  fontSize: 'ub:font-size',
  locale: LOCALE_KEY,
} as const;

export interface DevicePrefsDeps {
  readonly storage: StoragePort;
  readonly prefersDark: () => boolean;
  /** The language the device asks for, used until the person picks one. */
  readonly deviceLocale: Locale;
}

export function createDevicePrefs(deps: DevicePrefsDeps): PrefsPort {
  const { storage } = deps;
  return {
    read() {
      const theme = storage.getItem(PREF_KEYS.theme) ?? '';
      const size = storage.getItem(PREF_KEYS.fontSize) ?? '';
      const locale = storage.getItem(PREF_KEYS.locale) ?? '';
      return {
        theme: THEME_MODES.has(theme) ? theme : deps.prefersDark() ? 'dark' : 'light',
        fontSize: FONT_SIZES.has(size) ? size : 'medium',
        locale: LOCALES.has(locale) ? locale : deps.deviceLocale,
      };
    },
    write(patch) {
      if (patch.theme !== undefined) storage.setItem(PREF_KEYS.theme, patch.theme);
      if (patch.fontSize !== undefined) storage.setItem(PREF_KEYS.fontSize, patch.fontSize);
      if (patch.locale !== undefined) storage.setItem(PREF_KEYS.locale, patch.locale);
    },
  };
}

/** The part of the document root the prefs touch (a real `HTMLElement` fits). */
export interface PrefsRoot {
  readonly classList: { toggle(name: string, force: boolean): unknown };
  readonly style: { fontSize: string };
}

export function applyUiPrefs(root: PrefsRoot, prefs: Pick<UiPrefs, 'theme' | 'fontSize'>): void {
  root.classList.toggle('dark', prefs.theme === 'dark');
  root.style.fontSize = FONT_PX[prefs.fontSize];
}

/** Call once when the participant app starts: applies what is stored and returns it. */
export function startPrefs(port: PrefsPort, root: PrefsRoot): UiPrefs {
  const prefs = port.read();
  applyUiPrefs(root, prefs);
  return prefs;
}
