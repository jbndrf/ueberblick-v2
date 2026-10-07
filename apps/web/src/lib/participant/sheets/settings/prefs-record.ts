/**
 * The look of the app follows the person (WP-695, owner answer 3): theme, font size and language are read from and
 * written to the personal preference record (WP-612, `ui.theme`, `ui.font_size`, `ui.locale`) behind the same
 * `PrefsPort`, so a person keeps their look on every device. The device port stays underneath as the cache the page
 * reads before first paint (`app.html`) and the sign-in page reads before any session; before the record arrives the
 * device value shows.
 */
import type { PrefsClient } from '@ueberblick/client';
import {
  FONT_SIZES,
  LOCALES,
  THEME_MODES,
  applyUiPrefs,
  type PrefsPort,
  type PrefsRoot,
  type UiPrefs,
} from './prefs';
import type { Locale } from '../../messages';

export type LookRecord = Pick<PrefsClient, 'current' | 'set' | 'subscribe' | 'sync'>;

export const LOOK_PATHS = { theme: 'ui.theme', fontSize: 'ui.font_size', locale: 'ui.locale' } as const;

export interface RecordPrefsDeps {
  readonly client: LookRecord;
  /** The device cache (`createDevicePrefs`): the fallback until the record arrives. */
  readonly device: PrefsPort;
}

export function createRecordPrefs({ client, device }: RecordPrefsDeps): PrefsPort {
  return {
    read() {
      const ui = client.current().ui;
      const d = device.read();
      return {
        theme: ui.theme !== undefined && THEME_MODES.has(ui.theme) ? ui.theme : d.theme,
        fontSize: ui.font_size !== undefined && FONT_SIZES.has(ui.font_size) ? ui.font_size : d.fontSize,
        locale: ui.locale !== undefined && LOCALES.has(ui.locale) ? (ui.locale as Locale) : d.locale,
      };
    },
    write(patch) {
      device.write(patch); // first: a device that refuses throws before the record shows a setting that is not kept
      if (patch.theme !== undefined) client.set(LOOK_PATHS.theme, patch.theme);
      if (patch.fontSize !== undefined) client.set(LOOK_PATHS.fontSize, patch.fontSize);
      if (patch.locale !== undefined) client.set(LOOK_PATHS.locale, patch.locale);
      void client.sync();
    },
  };
}

export interface BindLookDeps extends RecordPrefsDeps {
  readonly port: PrefsPort;
  readonly root: PrefsRoot;
  /** The language the screen shows now. */
  readonly locale: Locale;
  readonly onlocale: (locale: Locale) => void;
}

/**
 * Keeps the page in step with the record: when it changes (a sync brought another device's choice), the device cache,
 * the document root and the screen's language follow. Applies the cached record once at the start. Returns the stop.
 */
export function bindLookToRecord(deps: BindLookDeps): () => void {
  let shown: UiPrefs['locale'] = deps.locale;
  const follow = (): void => {
    const now = deps.port.read();
    deps.device.write(now); // the cache of the record (pre-paint theme, sign-in language)
    applyUiPrefs(deps.root, now);
    if (now.locale !== shown) {
      shown = now.locale;
      deps.onlocale(now.locale);
    }
  };
  follow();
  return deps.client.subscribe(follow);
}
