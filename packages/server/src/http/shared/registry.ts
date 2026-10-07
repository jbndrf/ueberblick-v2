import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** Error codes of the HTTP envelope `{error: {code, message, issues?}}`, each with its status. */
export const HTTP_ERRORS = defineRegistry([
  { key: 'unauthenticated', status: 401, description: 'No valid session.' },
  { key: 'forbidden', status: 403, description: 'The session has no access to this project.' },
  { key: 'invalid_body', status: 400, description: 'The body is not JSON or does not match the schema.' },
  { key: 'payload_too_large', status: 413, description: 'The body is over the size limit.' },
  { key: 'batch_too_large', status: 413, description: 'The batch has more runs than the limit.' },
  {
    key: 'not_found',
    status: 404,
    description: 'No such route, collection or feature (also for one the caller may not see).',
  },
  { key: 'method_not_allowed', status: 405, description: 'The route exists but not for this method.' },
  {
    key: 'invalid_query',
    status: 400,
    description: 'A query parameter is unknown, malformed or not supported.',
  },
  {
    key: 'run_refused',
    status: 422,
    description: 'The write became a run and core.plan refused it (the refusal is in the message).',
  },
  {
    key: 'no_write_task',
    status: 422,
    description:
      'No single task can carry this write (none, several, or a delete); the message lists the candidates.',
  },
  {
    key: 'filter_too_broad',
    status: 422,
    description: 'A filter would examine more candidate features than the cap allows.',
  },
  {
    key: 'not_proxied',
    status: 404,
    description:
      'The map layer is self-hosted (a path on this instance): nothing is proxied, the map loads it directly (A-033).',
  },
  {
    key: 'upstream_failed',
    status: 502,
    description: 'A third-party source (a tile provider) did not answer; nothing was cached (A-033).',
  },
  {
    key: 'thumbnail_failed',
    status: 500,
    description:
      'An image blob could not be turned into a thumbnail (its bytes do not decode, or the file cannot be written).',
  },
  {
    key: 'conflict',
    status: 409,
    description: 'The project has no deployed config yet, or its version changed under the request.',
  },
  {
    key: 'busy',
    status: 503,
    description:
      'The project database stayed locked past its wait; nothing was written, and the same request can be sent again.',
  },
  {
    key: 'slug_taken',
    status: 409,
    description: 'A legal page with this slug exists: a create or a rename never overwrites it.',
  },
] as const);
export type HttpErrorCode = KeyOf<typeof HTTP_ERRORS>;
