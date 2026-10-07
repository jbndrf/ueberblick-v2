import { defineRegistry, type KeyOf } from '../registry/define';

/** Kinds of pull page (docs/07-sync-and-offline.md). */
export const SYNC_PAGE_KINDS = defineRegistry([
  { key: 'snapshot', description: 'A page of a full snapshot (since=0), paged by feature.' },
  { key: 'delta', description: 'Features, edges and tombstones changed after the requested seq.' },
] as const);
export type SyncPageKind = KeyOf<typeof SYNC_PAGE_KINDS>;

/** What a tombstone removes. */
export const SYNC_TOMBSTONE_KINDS = defineRegistry([
  { key: 'feature', description: 'A feature that left the participant scope or was removed.' },
  { key: 'edge', description: 'An edge that no longer exists.' },
  {
    key: 'redaction',
    description:
      "One personal property of a feature was blanked; id is `<featureId>#<property>`. The page carries the feature row; the device drops that property's cached history.",
  },
  { key: 'blob', description: 'A blob was purged; id is its sha256. The device drops its cached bytes.' },
] as const);
export type SyncTombstoneKind = KeyOf<typeof SYNC_TOMBSTONE_KINDS>;

/** Typed failures of the sync codec. Nothing falls back silently (R11). */
export const SYNC_ERROR_CODES = defineRegistry([
  { key: 'version_mismatch', description: 'The peer speaks another protocol version.' },
  { key: 'missing_column', description: 'A tuple table lacks a column this protocol version requires.' },
  {
    key: 'history_exceeded',
    description: 'More than SYNC_OBSERVATION_HISTORY observations share one feature and property.',
  },
  { key: 'malformed', description: 'The payload does not have the shape of the protocol.' },
] as const);
export type SyncErrorCode = KeyOf<typeof SYNC_ERROR_CODES>;
