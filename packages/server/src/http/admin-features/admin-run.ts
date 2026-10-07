/**
 * Submitting one run the admin started (`$correct`, `$create`, `$lifecycle`) through the project's store, and the HTTP
 * answer when it is refused (the one write path, R3). Shared by the three endpoints so they refuse alike.
 *
 *   422 run_refused { issues: [{ path, message }] }   refused; `path` names the bad value
 *   409 conflict                                      the config version is gone, or `input.expected_seq` was stale
 */
import type { Run } from '@ueberblick/core';
import { ConfigVersionGone, NoDeployedVersion, type Store } from '../../store';
import { errorResponse } from '../shared/errors';

const STALE_PATH = 'input.expected_seq';

export type AdminRunResult =
  { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly response: Response };

export function submitAdminRun(store: Store, run: Run): AdminRunResult {
  let result;
  try {
    result = store.submit(run);
  } catch (e) {
    if (e instanceof ConfigVersionGone || e instanceof NoDeployedVersion)
      return {
        ok: false,
        response: errorResponse('conflict', 'The project config changed; reload and edit again.'),
      };
    throw e;
  }
  if (result.outcome === 'refused' && result.refusal.path === STALE_PATH)
    return {
      ok: false,
      response: errorResponse(
        'conflict',
        'The Objekt changed since the table loaded it; reload and edit again.',
      ),
    };
  if (result.outcome === 'refused')
    return {
      ok: false,
      response: errorResponse('run_refused', result.refusal.message, [
        { path: result.refusal.path ?? '', message: result.refusal.message },
      ]),
    };
  return { ok: true, runId: result.runId };
}
