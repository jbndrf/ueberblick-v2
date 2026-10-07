/**
 * `POST /api/p/<project>/runs` and `POST /api/p/<project>/runs/batch` (WP-105) as Web `Request -> Response`
 * handlers over the store. Status: 200 accepted, 422 refused, 409 review (config version gone). The store is the
 * ledger, so a repeated run id answers its stored result again with the same status.
 */
import {
  SYNC_PROTOCOL_VERSION,
  type Actor,
  type FeatureId,
  type Key,
  type Run,
  type RunId,
} from '@ueberblick/core';
import {
  ConfigVersionGone,
  NoDeployedVersion,
  type BatchResult,
  type Store,
  type SubmitResult,
} from '../../store';
import { errorKind, isBusy } from '../../store/run/transaction';
import { authorizeProject, DEVICE_KINDS } from '../shared/access';
import { readBody } from '../shared/body';
import {
  DEFAULT_HTTP_LIMITS,
  type Handler,
  type HttpLimits,
  type ProjectAccessDeps,
} from '../shared/contract';
import type { Logger } from '../../log';
import { errorResponse, jsonResponse } from '../shared/errors';
import { withParticipant } from '../shared/session-participant';
import { BatchRequestSchema, RunRequestSchema, type RunRequest, type ReviewResponse } from './schema';

export interface RunsDeps extends ProjectAccessDeps {
  /** The store of the project with this key (one per project database). */
  store(projectKey: string): Store;
  readonly limits?: Partial<HttpLimits>;
  /**
   * Where `run.failed` goes: an intake that threw is named here, since `handleError` logs no message. Both runtime
   * wirings pass it; the simulation and the bench harness (outside this package) do not need the line.
   */
  readonly log: Logger;
}

export interface RunHandlers {
  readonly submit: Handler<{ readonly project: string }>;
  readonly batch: Handler<{ readonly project: string }>;
}

const toRun = (r: RunRequest, actor: Actor): Run => ({
  id: r.id as RunId,
  task: r.task as Key,
  actor,
  configVersion: r.configVersion,
  input: r.input,
  ...(r.featureId !== undefined ? { featureId: r.featureId as FeatureId } : {}),
  ...(r.clientTime !== undefined ? { clientTime: r.clientTime } : {}),
});

const review = (runId: string, configVersion: number): ReviewResponse => ({
  v: SYNC_PROTOCOL_VERSION,
  outcome: 'review',
  runId,
  reason: 'config_version_gone',
  configVersion,
});

const STATUS = { accepted: 200, refused: 422, review: 409 } as const;

/**
 * The one place a run reply is finished (WP-144): every reply of both handlers, success, refusal, review and
 * every error (401, 403, 400, 413), leaves through here and gets the top-level `v: SYNC_PROTOCOL_VERSION`, so no
 * reply path can omit it. The client refuses an incompatible server on it.
 */
const versioned =
  <P extends Readonly<Record<string, string>>>(handler: Handler<P>): Handler<P> =>
  async (req, ctx) => {
    const res = await handler(req, ctx);
    const body: unknown = await res.json();
    const obj = typeof body === 'object' && body !== null ? body : {};
    return new Response(JSON.stringify({ v: SYNC_PROTOCOL_VERSION, ...obj }), {
      status: res.status,
      headers: res.headers,
    });
  };

export function createRunHandlers(deps: RunsDeps): RunHandlers {
  const limits: HttpLimits = { ...DEFAULT_HTTP_LIMITS, ...deps.limits };

  /**
   * What the intake answers when the store threw (nothing was written, the transaction rolled back): a gone config
   * version is a review, a locked database a retryable 503, a database with no deployed config a 409. Anything else is
   * a bug and stays a 500, but it is named in the log first. The client queue settles only 200, 422 and 409 with the
   * typed envelope and retries every other status, so 503 and the 409 error envelope are retried (WP-841).
   */
  const failed = (runId: string, size: number, e: unknown): Response => {
    if (e instanceof NoDeployedVersion)
      return errorResponse('conflict', 'The project has no deployed config yet.');
    deps.log.log('run.failed', { runId, size, code: errorKind(e) });
    if (isBusy(e)) return errorResponse('busy', 'The project database is busy; send the run again.');
    throw e;
  };

  const submit: RunHandlers['submit'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const body = await readBody(req, RunRequestSchema, limits.maxBodyBytes);
    if (body instanceof Response) return body;
    let result: SubmitResult | ReviewResponse;
    try {
      result = deps.store(caller.project.key).submit(toRun(body, caller.actor));
    } catch (e) {
      if (!(e instanceof ConfigVersionGone)) return failed(body.id, 1, e);
      result = review(body.id, e.version);
    }
    return withParticipant(jsonResponse(result, STATUS[result.outcome]), caller.actor.id);
  };

  const batch: RunHandlers['batch'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const body = await readBody(req, BatchRequestSchema, limits.maxBatchBodyBytes);
    if (body instanceof Response) return body;
    if (body.runs.length > limits.maxBatchRuns)
      return errorResponse('batch_too_large', `A batch takes at most ${limits.maxBatchRuns} runs.`);
    let result: BatchResult | ReviewResponse;
    try {
      result = deps.store(caller.project.key).submitBatch(body.runs.map((r) => toRun(r, caller.actor)));
    } catch (e) {
      if (!(e instanceof ConfigVersionGone)) return failed(body.runs[0]?.id ?? '', body.runs.length, e);
      const culprit = body.runs.find((r) => r.configVersion === e.version) ?? body.runs[0];
      result = review(culprit?.id ?? '', e.version);
    }
    return withParticipant(jsonResponse(result, STATUS[result.outcome]), caller.actor.id);
  };

  return { submit: versioned(submit), batch: versioned(batch) };
}
