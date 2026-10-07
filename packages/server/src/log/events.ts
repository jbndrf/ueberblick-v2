import { defineRegistry, type KeyOf } from '@ueberblick/core';

/**
 * The only kinds of field a log line may carry (WP-537, docs/process/logging.md). There is deliberately
 * no kind for a value, run input or personal data: what is not declared here cannot be logged.
 */
export const LOG_FIELD_KINDS = defineRegistry([
  { key: 'code', description: 'A short machine code (refusal code, error code, route name).' },
  { key: 'actor', description: 'An actor id (pseudonymous; never a name or contact).' },
  { key: 'ip', description: 'A client address; truncated to /24 (IPv4) or /48 (IPv6) before it is written.' },
  { key: 'id', description: 'An opaque id (run id, request id, project key).' },
  { key: 'count', description: 'A non-negative count.' },
  { key: 'ms', description: 'A duration in milliseconds.' },
] as const);
export type LogFieldKind = KeyOf<typeof LOG_FIELD_KINDS>;

export const LOG_LEVELS = defineRegistry([
  { key: 'debug', description: 'Developer detail; off by default.' },
  { key: 'info', description: 'Normal operation.' },
  { key: 'warn', description: 'Recoverable problem.' },
  { key: 'error', description: 'Failure that needs attention (logwatch reads these).' },
] as const);
export type LogLevel = KeyOf<typeof LOG_LEVELS>;

/** The TypeScript type each field kind accepts. */
export interface LogFieldType {
  code: string;
  actor: string;
  ip: string;
  id: string;
  count: number;
  ms: number;
}

/** Field names a log line may never have, in any event (checked by a test over the registry). */
export const FORBIDDEN_LOG_FIELDS = [
  'value',
  'values',
  'input',
  'name',
  'email',
  'phone',
  'position',
  'body',
] as const;

export interface LogEventSpec {
  readonly key: string;
  readonly description: string;
  readonly level: LogLevel;
  readonly fields: { readonly [name: string]: LogFieldKind };
}

/** Events the server may log. Add one here to log something new; fields are declared by kind. */
export const LOG_EVENTS = [
  {
    key: 'run.refused',
    description: 'A run was refused by core.plan.',
    level: 'info',
    fields: { runId: 'id', actor: 'actor', code: 'code', ms: 'ms' },
  },
  {
    key: 'run.committed',
    description: 'A run was committed.',
    level: 'info',
    fields: { runId: 'id', actor: 'actor', observations: 'count', ms: 'ms' },
  },
  {
    key: 'auth.failed',
    description: 'A sign-in or token check failed.',
    level: 'warn',
    fields: { code: 'code', ip: 'ip', actor: 'actor' },
  },
  {
    key: 'http.error',
    description: 'A request ended in a server error.',
    level: 'error',
    fields: { requestId: 'id', route: 'code', code: 'code', ip: 'ip', ms: 'ms' },
  },
  {
    key: 'http.access',
    description:
      'One line per request (WP-1043): method, route pattern (never the path or query), status, truncated address, duration. No user agent, no byte count.',
    level: 'info',
    fields: { method: 'code', route: 'code', status: 'count', ip: 'ip', ms: 'ms' },
  },
  {
    key: 'blob.thumbnail_failed',
    description:
      'An image blob could not be turned into a thumbnail; `code` is decode_failed or write_failed.',
    level: 'error',
    fields: { code: 'code', id: 'id' },
  },
  {
    key: 'sync.served',
    description: 'A sync page was served.',
    level: 'info',
    fields: { requestId: 'id', actor: 'actor', tuples: 'count', ms: 'ms' },
  },
  {
    key: 'timer.dropped',
    description:
      'A time rule has no next run inside the horizon and is not scheduled (once per rule per version).',
    level: 'warn',
    fields: { ruleId: 'id', code: 'code' },
  },
  {
    key: 'blob.delete_failed',
    description: 'Blob bytes of an erased value were not deleted; the next start sweeps them again.',
    level: 'error',
    fields: { projectKey: 'id', code: 'code' },
  },
  {
    key: 'run.failed',
    description:
      'The run intake threw instead of answering (a locked database, a bug): the kind of error, never its message.',
    level: 'error',
    fields: { runId: 'id', size: 'count', code: 'code' },
  },
  {
    key: 'run.hook_failed',
    description:
      'A step after a run committed (erasing orphaned blobs, writing the run log) threw; the run stays accepted: the hook and the kind of error, never its message.',
    level: 'error',
    fields: { hook: 'code', code: 'code' },
  },
  {
    key: 'timers.failed',
    description: 'A timers tick threw for a project; the rows stay for the next tick.',
    level: 'error',
    fields: { projectKey: 'id', code: 'code' },
  },
  {
    key: 'moves.failed',
    description:
      'The deploy value-move executor threw for a project; its rows stay open for the next start (WP-307).',
    level: 'error',
    fields: { projectKey: 'id', code: 'code' },
  },
  {
    key: 'preview.refresh_failed',
    description:
      'A preview refresh threw for a project (not a refused draft); the preview stays as it was (WP-341).',
    level: 'error',
    fields: { projectKey: 'id', code: 'code' },
  },
  {
    key: 'packs.failed',
    description:
      'An offline pack layer gave up building (`code` build_failed; the row keeps the reason for the admin) or a pack drain threw (`drain_threw`); the next deploy or rebuild queues it again (WP-351).',
    level: 'error',
    fields: { projectKey: 'id', code: 'code' },
  },
  {
    key: 'tiles.sweep_failed',
    description:
      'The startup sweep of abandoned tile uploads failed for a project (`code` sweep_threw); the next start retries it (WP-405).',
    level: 'error',
    fields: { projectKey: 'id', code: 'code' },
  },
] as const satisfies readonly LogEventSpec[];

export type LogEvents = typeof LOG_EVENTS;
export type LogEventKey = LogEvents[number]['key'];
export type LogEventOf<K extends LogEventKey> = Extract<LogEvents[number], { key: K }>;

/** The exact object a caller passes for event K: every declared field, no other. */
export type LogFields<K extends LogEventKey> = {
  [F in keyof LogEventOf<K>['fields']]: LogFieldType[LogEventOf<K>['fields'][F] & LogFieldKind];
};
