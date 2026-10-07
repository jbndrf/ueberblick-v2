/**
 * `POST /api/admin/p/<project>/features/<id>/correct` (E-11, WP-370): the 'Admin-Korrektur' of the data page. Body
 * `{ values: { <property>: value }, expected_seq? }`; one call is one `$correct` run on the feature, planned by core
 * (every value checked, rules and computed values as for any run) and submitted through the project's store (R3).
 * `expected_seq` is the `$seq` of the row the admin edited: a feature that changed since is refused with 409, so a
 * stale edit never overwrites a newer value.
 *
 *   200 { runId, seq }                              accepted; `seq` is the feature's new `$seq`
 *   422 run_refused { issues: [{ path, message }] } refused; `path` names the bad value (`input.values.<property>`)
 *   409 conflict                                    stale `expected_seq`, or the config version is gone
 */
import {
  CORRECT_TASK,
  type Clock,
  type FeatureId,
  type Ids,
  type Json,
  type Key,
  type Run,
} from '@ueberblick/core';
import { z } from '@ueberblick/core/zod';
import type { Db } from '../../db/driver';
import type { Store } from '../../store';
import { submitAdminRun } from './admin-run';
import { readBody } from '../shared/body';
import { errorResponse, jsonResponse } from '../shared/errors';
import type { DeployedConfig } from '../../sync';

/** Body limit: one row's edits are small. */
const MAX_BODY_BYTES = 256 * 1024;

const BodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
  expected_seq: z.number().int().nonnegative().optional(),
});

export interface CorrectDeps {
  readonly store: (projectKey: string) => Store;
  readonly ids: Ids;
  readonly clock: Clock;
}

export async function correctFeature(
  deps: CorrectDeps,
  call: { readonly request: Request; readonly adminId: string },
  target: {
    readonly projectKey: string;
    readonly db: Db;
    readonly deployed: DeployedConfig;
    readonly id: string;
  },
): Promise<Response> {
  const body = await readBody(call.request, BodySchema, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  if (Object.keys(body.values).length === 0)
    return errorResponse('invalid_body', 'The request body does not match the schema.', [
      { path: 'values', message: 'Needs at least one value.' },
    ]);
  const row = target.db
    .prepare<{ seq: number }>('SELECT updated_seq AS seq FROM features WHERE id = ?')
    .get(target.id);
  if (row === undefined) return errorResponse('not_found', `The project has no feature '${target.id}'.`);
  const run: Run = {
    id: deps.ids.runId(),
    task: CORRECT_TASK as Key,
    actor: { id: call.adminId, kind: 'admin', roles: [] },
    configVersion: target.deployed.version,
    featureId: target.id as FeatureId,
    clientTime: deps.clock.now(),
    input: {
      values: body.values as { readonly [k: string]: Json },
      // Checked by core inside the run's transaction (`plan/correct-task.ts`), not here.
      ...(body.expected_seq === undefined ? {} : { expected_seq: body.expected_seq }),
    },
  };
  const submitted = submitAdminRun(deps.store(target.projectKey), run);
  if (!submitted.ok) return submitted.response;
  const after = target.db
    .prepare<{ seq: number }>('SELECT updated_seq AS seq FROM features WHERE id = ?')
    .get(target.id);
  return jsonResponse({ runId: submitted.runId, seq: after?.seq ?? row.seq });
}
