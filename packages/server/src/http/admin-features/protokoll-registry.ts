import { defineRegistry, type KeyOf } from '@ueberblick/core/registry';

/** Why a run has no Protokoll (WP-372): all are a 404 of the endpoint. */
export const PROTOKOLL_MISSES = defineRegistry([
  { key: 'run_not_found', description: 'The feature has no run with this id.' },
  { key: 'run_refused', description: 'The run was refused, so it wrote nothing to show.' },
  { key: 'version_gone', description: 'The config version the run was made under is no longer stored.' },
] as const);
export type ProtokollMiss = KeyOf<typeof PROTOKOLL_MISSES>;
