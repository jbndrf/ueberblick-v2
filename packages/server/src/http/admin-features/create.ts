/**
 * The admin's two row writes beside the correction (WP-382): `POST …/features` adds one Objekt (a row of a Tabelle, one
 * `$create` run, E-12) and `POST …/features/<id>/lifecycle` sets its lifecycle (delete, one `$lifecycle` run, E-13).
 * Both are planned by core and submitted through the project's store (R3), as `correct` is.
 *
 *   POST features             { type, values }  -> 201 { runId, id } | 422 run_refused | 404 unknown type | 409
 *   POST features/<id>/lifecycle { state }      -> 200 { runId }     | 400 bad state | 404 unknown Objekt | 422 | 409
 */
import {
  CREATE_TASK,
  LIFECYCLE_STATES,
  LIFECYCLE_TASK,
  type FeatureId,
  type Json,
  type Key,
  type Run,
} from '@ueberblick/core';
import { z } from '@ueberblick/core/zod';
import type { Db } from '../../db/driver';
import type { DeployedConfig } from '../../sync';
import { readBody } from '../shared/body';
import { errorResponse, jsonResponse } from '../shared/errors';
import { submitAdminRun } from './admin-run';
import type { CorrectDeps } from './correct';

const MAX_BODY_BYTES = 256 * 1024;

const CreateBody = z.object({ type: z.string().min(1), values: z.record(z.string(), z.unknown()) });
const LifecycleBody = z.object({ state: z.string().refine((s) => LIFECYCLE_STATES.has(s)) });

interface Target {
  readonly projectKey: string;
  readonly db: Db;
  readonly deployed: DeployedConfig;
}

export async function createFeature(
  deps: CorrectDeps,
  call: { readonly request: Request; readonly adminId: string },
  target: Target,
): Promise<Response> {
  const body = await readBody(call.request, CreateBody, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  if (target.deployed.config.file.types?.[body.type] === undefined)
    return errorResponse('not_found', `The project has no feature type '${body.type}'.`);
  const id = deps.ids.featureId();
  const run: Run = {
    id: deps.ids.runId(),
    task: CREATE_TASK as Key,
    actor: { id: call.adminId, kind: 'admin', roles: [] },
    configVersion: target.deployed.version,
    featureId: id,
    clientTime: deps.clock.now(),
    input: { type: body.type, values: body.values as { readonly [k: string]: Json } },
  };
  const submitted = submitAdminRun(deps.store(target.projectKey), run);
  if (!submitted.ok) return submitted.response;
  return jsonResponse({ runId: submitted.runId, id }, 201);
}

export async function setLifecycle(
  deps: CorrectDeps,
  call: { readonly request: Request; readonly adminId: string },
  target: Target & { readonly id: string },
): Promise<Response> {
  const body = await readBody(call.request, LifecycleBody, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  if (target.db.prepare('SELECT 1 FROM features WHERE id = ?').get(target.id) === undefined)
    return errorResponse('not_found', `The project has no feature '${target.id}'.`);
  const run: Run = {
    id: deps.ids.runId(),
    task: LIFECYCLE_TASK as Key,
    actor: { id: call.adminId, kind: 'admin', roles: [] },
    configVersion: target.deployed.version,
    featureId: target.id as FeatureId,
    clientTime: deps.clock.now(),
    input: { state: body.state },
  };
  const submitted = submitAdminRun(deps.store(target.projectKey), run);
  if (!submitted.ok) return submitted.response;
  return jsonResponse({ runId: submitted.runId });
}
