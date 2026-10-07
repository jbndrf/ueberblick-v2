/**
 * The last open tab of the sheet survives close, reopen and reload (v3 `createPersistedTab('settings', 'profile')`,
 * `participant-state/ui-state.svelte.ts:32`). Device-local; a storage that throws is ignored.
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core/registry';

export const SETTINGS_TABS = defineRegistry([
  { key: 'profile', description: 'Profil: connection, sync, queue, participant, roles, legal pages.' },
  { key: 'options', description: 'Optionen: theme, font size, language, Werkzeuge.' },
  { key: 'offline', description: 'Offline: install, tile packs, offline images (WP-650).' },
] as const);
export type SettingsTab = KeyOf<typeof SETTINGS_TABS>;

const KEY = 'ueberblick:ui-tab:settings';

export function readTab(storage: Pick<Storage, 'getItem'> | undefined): SettingsTab {
  try {
    const v = storage?.getItem(KEY);
    return SETTINGS_TABS.keys.find((t) => t === v) ?? 'profile';
  } catch {
    return 'profile';
  }
}

export function writeTab(storage: Pick<Storage, 'setItem'> | undefined, tab: string): void {
  try {
    storage?.setItem(KEY, tab);
  } catch {
    // quota or private mode: the tab is simply not remembered
  }
}
