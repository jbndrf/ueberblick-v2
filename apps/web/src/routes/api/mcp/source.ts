/**
 * Where the MCP endpoint gets its draft store, template source and confirmation key: the one place the
 * routes reach the runtime. The key is `UEBERBLICK_MCP_SECRET` (via `config/`), or a random one per process (tokens do
 * not survive a restart, which only means a proposal is confirmed again).
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { ConfirmationPort } from '@ueberblick/builder';
import { draftSources } from '@ueberblick/server';
import { config } from '$lib/server/config';
import { runtime } from '$lib/server/runtime';
import { ensure, put } from '../../../lib/admin/draft/draft-source.server';
import type { McpDeps } from './handler';

let key: string | undefined;
/** Read on first use, not at import: the build imports route modules to analyse them, without an environment. */
const confirmationKey = (): string => (key ??= config().mcpSecret ?? randomBytes(32).toString('hex'));

/** A confirmation is a decision of minutes, not of days. */
export const CONFIRMATION_TTL_MS = 10 * 60_000;

export const confirmation: ConfirmationPort = {
  sign: (message) => createHmac('sha256', confirmationKey()).update(message).digest('hex'),
  now: () => Date.now(),
  ttlMs: CONFIRMATION_TTL_MS,
};

export const deps = (authorize: McpDeps['authorize']): McpDeps => ({
  authorize,
  ensure,
  put,
  templateSource: (template, templateVersion) =>
    draftSources(
      { template, templateVersion, overlay: '', revision: 0, updatedBy: null, updatedAt: '' },
      runtime().templates,
    )?.templateSrc,
  confirmation,
});
