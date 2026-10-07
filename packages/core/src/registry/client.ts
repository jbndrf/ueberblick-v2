/** Registries of the device store (F8, R6). */
import { defineRegistry, type KeyOf } from './define';

/** Typed failures. None of them deletes the database (docs/research/v3-device-runtime.md §5 item 1). */
export const STORE_ERROR_CODES = defineRegistry([
  { key: 'open_failed', description: 'IndexedDB could not be opened. The database is kept untouched.' },
  { key: 'blocked', description: 'Another tab holds an older connection and blocks the upgrade.' },
  {
    key: 'terminated',
    description: 'The browser closed the connection abnormally. Runs stay readable for export.',
  },
  { key: 'version_change', description: 'Another tab upgrades the database; this connection was closed.' },
  { key: 'unavailable', description: 'The store is closed; only exportRuns() still works.' },
  {
    key: 'quota_exceeded',
    description: 'The write did not fit into the storage quota. Nothing was written.',
  },
  { key: 'aborted', description: 'The transaction aborted. Nothing was written.' },
  {
    key: 'history_not_warm',
    description: 'history() was called for a feature whose history was not loaded.',
  },
  {
    key: 'not_writer',
    description:
      'A cache write (applyPage, clearCache, dropHistory, deleteBlob) reached the read replica; the sync worker is the only writer (B-012).',
  },
  {
    key: 'text_source_not_indexed',
    description:
      'searchText() named a (type, property) that indexText() never registered (a programming error).',
  },
] as const);
export type StoreErrorCode = KeyOf<typeof STORE_ERROR_CODES>;

/** What the store found when it opened. */
export const STORE_ORIGINS = defineRegistry([
  { key: 'fresh', description: 'A new database on a device that never held data.' },
  { key: 'existing', description: 'The database existed and was opened as is.' },
  {
    key: 'evicted',
    description: 'The database is new but the device was initialised before: the browser dropped it.',
  },
] as const);
export type StoreOrigin = KeyOf<typeof STORE_ORIGINS>;

/** What the sync worker is doing now (`SyncStatus.phase`). */
export const SYNC_PHASES = defineRegistry([
  { key: 'idle', description: 'Nothing running; the store is as current as the last pull.' },
  { key: 'snapshot', description: 'Loading a full snapshot page by page.' },
  { key: 'delta', description: 'Catching up with changes after the stored cursor.' },
] as const);
export type SyncPhase = KeyOf<typeof SYNC_PHASES>;

/** Classes of pull failure. Only `transport` is worth a retry without a change. */
export const SYNC_FAILURE_KINDS = defineRegistry([
  { key: 'transport', description: 'Network, timeout or server error; try again later.' },
  {
    key: 'protocol',
    description: 'The peer broke the protocol (typed core/sync code); never retried blindly.',
  },
  { key: 'store', description: 'The device store refused a page (typed store code).' },
] as const);
export type SyncFailureKind = KeyOf<typeof SYNC_FAILURE_KINDS>;

/** Why a pull threw away the local copy and started a snapshot. */
export const SYNC_RESET_REASONS = defineRegistry([
  { key: 'first_sync', description: 'The device holds no cursor.' },
  {
    key: 'scope_changed',
    description: 'The scope fingerprint differs from the one the device synced under.',
  },
  { key: 'server_reset', description: 'The server head is behind the stored cursor.' },
  {
    key: 'snapshot_restart',
    description: 'The server pinned another head than the one this snapshot began with.',
  },
] as const);
export type SyncResetReason = KeyOf<typeof SYNC_RESET_REASONS>;

/** What makes the engine pull (docs/07: doorbell, plus open, online and visibilitychange for iOS). */
export const SYNC_TRIGGERS = defineRegistry([
  { key: 'open', description: 'The app or worker started.' },
  { key: 'online', description: 'The browser regained the network.' },
  { key: 'visible', description: 'The page became visible again.' },
  { key: 'doorbell', description: 'The server said "something changed".' },
] as const);
export type SyncTrigger = KeyOf<typeof SYNC_TRIGGERS>;

/** Where a queued run stands on the device (docs/07 "Run queue"). Only `sending` is never stored: a crash re-sends. */
export const QUEUE_RUN_STATES = defineRegistry([
  { key: 'queued', description: 'Stored and predicted; waiting for its turn to be sent.' },
  { key: 'sending', description: 'A request for this run is in flight (memory only, never stored).' },
  {
    key: 'accepted',
    description: 'The server accepted it; the prediction stays until a pull has reached its seq.',
  },
  { key: 'refused', description: 'A refusal with a code; the input stays as a recoverable draft.' },
  {
    key: 'dependent',
    description:
      "Refused on the device because an earlier run was refused (v3 dependent_rejected): carries that run's refusal, stays a recoverable draft.",
  },
  {
    key: 'review',
    description: 'The server no longer holds its config version; kept for review, never dropped.',
  },
] as const);
export type QueueRunState = KeyOf<typeof QUEUE_RUN_STATES>;

/** Whether a run's input stays as a recoverable draft with a refusal (sent again or discarded by the person). */
export const isRefusedRunState = (state: QueueRunState): boolean =>
  state === 'refused' || state === 'dependent';

/** How a run of the Aktivität timeline stands for this device (WP-602): synced, still on its way, or refused. */
export const ACTIVITY_STATUSES = defineRegistry([
  { key: 'accepted', description: 'The server holds the run; its values came with the sync.' },
  {
    key: 'pending',
    description: 'Still in this device queue (queued, sending, accepted but not pulled, review).',
  },
  { key: 'refused', description: 'Refused; the typed values stay on the device as a draft.' },
] as const);
export type ActivityStatus = KeyOf<typeof ACTIVITY_STATUSES>;

/** Typed failures of the run queue API (preconditions; refusals are values, never thrown). */
export const QUEUE_ERROR_CODES = defineRegistry([
  { key: 'invalid_batch', description: 'A batch is empty, has duplicate ids or mixes config versions.' },
  { key: 'config_unavailable', description: "The device does not hold the run's config version yet." },
  { key: 'not_found', description: 'No run with this id is on the device.' },
  { key: 'not_discardable', description: 'Only a refused or review run can be discarded or resubmitted.' },
] as const);
export type QueueErrorCode = KeyOf<typeof QUEUE_ERROR_CODES>;

/** Why the queue is not sending although runs wait (`QueueStatus.hold`). */
export const QUEUE_HOLDS = defineRegistry([
  { key: 'auth_expired', description: 'The session expired; sign in again. No run is lost.' },
  {
    key: 'awaiting_config',
    description: 'The head run needs a config version the device is still fetching.',
  },
  { key: 'backoff', description: 'The last attempt failed transiently; retrying after a capped delay.' },
  {
    key: 'incompatible_protocol',
    description:
      'The server speaks another protocol version than this app. No retry: update the app. No run is lost.',
  },
] as const);
export type QueueHold = KeyOf<typeof QUEUE_HOLDS>;

/** What the blob upload port answers when the server did not store the bytes (WP-605). A network error throws instead. */
export const BLOB_PUT_RESULTS = defineRegistry([
  { key: 'ok', description: 'The server holds the bytes now (or already did).' },
  { key: 'mismatch', description: 'The bytes do not hash to the sha256 (refusal `blob_mismatch`).' },
  { key: 'too_large', description: 'The bytes are over the upload limit (refusal `blob_too_large`).' },
] as const);
export type BlobPutResult = KeyOf<typeof BLOB_PUT_RESULTS>;
