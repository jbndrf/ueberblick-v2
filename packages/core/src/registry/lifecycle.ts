import { defineRegistry, type KeyOf } from './define';

/**
 * The system lifecycle of a feature (A-028 item 2): written only by a run, through the `lifecycle` then step, as the
 * reserved key `$lifecycle`. A feature starts `active`. `archived` and `deleted` features are not served to devices
 * and accept no run (`case_closed`); `completed` ones still accept runs. `label` is the text shown to people. `keepsValues` says a deploy's value moves still rewrite the feature (everything but `deleted`: archived ones stay in admin views and exports).
 */
export const LIFECYCLE_STATES = defineRegistry([
  {
    key: 'active',
    label: { en: 'active', de: 'aktiv' },
    served: true,
    keepsValues: true,
    description: 'The feature is in use. Every new feature starts here.',
  },
  {
    key: 'completed',
    label: { en: 'completed', de: 'abgeschlossen' },
    served: true,
    keepsValues: true,
    description: 'The case is done; it is still served and still accepts runs (a run can reopen it).',
  },
  {
    key: 'archived',
    label: { en: 'archived', de: 'archiviert' },
    served: false,
    keepsValues: true,
    description: 'Out of daily use: not served to devices, accepts no run. Admin reads still see it.',
  },
  {
    key: 'deleted',
    label: { en: 'deleted', de: 'gelöscht' },
    served: false,
    keepsValues: false,
    description: 'Removed: not served to devices, accepts no run. Needs `permissions.delete`.',
  },
] as const);
export type LifecycleState = KeyOf<typeof LIFECYCLE_STATES>;

/** The states a feature is served in (devices and `Facts` reads); the registry flag is the one source. */
export const SERVED_LIFECYCLE_STATES: readonly LifecycleState[] = LIFECYCLE_STATES.entries
  .filter((e) => e.served)
  .map((e) => e.key);

const served = new Set<string>(SERVED_LIFECYCLE_STATES);
export const isServed = (s: LifecycleState): boolean => served.has(s);

/** A present feature in a served state (the far-end rule of relations). */
export const isLive = (f: { readonly lifecycle: LifecycleState } | undefined): boolean =>
  f !== undefined && isServed(f.lifecycle);

/** The SQL condition of "served" for a `lifecycle` column: `lifecycle IN ('active','completed')`. */
export const servedSql = (column: string): string =>
  `${column} IN (${SERVED_LIFECYCLE_STATES.map((k) => `'${k}'`).join(',')})`;

const keeps = new Set<string>(LIFECYCLE_STATES.entries.filter((e) => e.keepsValues).map((e) => e.key));
/** The feature's values are still kept current by value moves (deploy `{ to }` mappings). */
export const keepsValues = (s: LifecycleState): boolean => keeps.has(s);

/** The SQL condition of "keeps values" for a `lifecycle` column. */
export const keepsValuesSql = (column: string): string =>
  `${column} IN (${LIFECYCLE_STATES.entries
    .filter((e) => e.keepsValues)
    .map((e) => `'${e.key}'`)
    .join(',')})`;
