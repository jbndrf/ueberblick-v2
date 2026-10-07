/**
 * Part 4 writes (create, replace, update, delete of items) as runs (R3, H6). The caller is an admin or a participant
 * (cookie session or API token, A-043); the run is recorded with the caller's actor, so core `plan` applies the
 * participant's role, `when`, field-write permissions and rules exactly as in the app (R1: no second check here).
 * `resolveWriteTask` names the one task that carries the change. Replace
 * (PUT) and update (PATCH) send only the properties whose value differs from the current one, so an unchanged
 * feature writes nothing (204, no run); a property missing from a PUT body is left as it is.
 */
import { z } from '@ueberblick/core/zod';
import {
  createPlan,
  formApi,
  JsonSchema,
  PLAN_MAX_RULE_DEPTH,
  type CompiledConfig,
  type FeatureId,
  type Geometry,
  type Json,
  type Key,
  type PlanPorts,
  type Run,
} from '@ueberblick/core';
import { ConfigVersionGone } from '../../store';
import { readBody } from '../shared/body';
import { errorResponse } from '../shared/errors';
import { DEFAULT_HTTP_LIMITS } from '../shared/contract';
import { primaryGeometry, serializerFor } from './feature';
import { readOne } from './items';
import type { Ctx } from './context';
import { CRS84 } from './seams';
import { resolveWriteTask, type WriteChange } from './write-task';

const BodySchema = z.looseObject({
  type: z.literal('Feature'),
  geometry: z.union([z.null(), z.looseObject({ type: z.string() })]),
  properties: z.record(z.string(), JsonSchema).nullish(),
});

/** The `…For` forms: a feature is checked and planned under its own config version (A-029, WP-316). */
const plan = createPlan(formApi);

/** Key-order independent JSON text, so `{a:1,b:2}` equals `{b:2,a:1}`. */
function stable(v: Json | undefined): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${(v as readonly Json[]).map(stable).join(',')}]`;
  const o = v as { readonly [k: string]: Json };
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

function bodyCrs(req: Request, ctx: Ctx): string | Response {
  const raw = req.headers.get('content-crs');
  if (raw === null) return CRS84;
  const uri = raw.trim().replace(/^<|>$/g, '');
  if (uri === CRS84) return CRS84;
  return ctx.seams.crs.supported.includes(uri)
    ? uri
    : errorResponse('invalid_query', `Content-Crs '${uri}' is not supported.`);
}

/** A participant's refusal for permission (role, `when`, field write) is 403; any other refusal stays 422. */
const PERMISSION_REFUSALS: readonly string[] = ['not_permitted', 'not_available'];
const permissionRefusal = (ctx: Ctx, code: string): boolean =>
  ctx.caller.actor.kind === 'participant' && PERMISSION_REFUSALS.includes(code);

export async function handleWrite(
  ctx: Ctx,
  req: Request,
  method: string,
  fid: string | undefined,
): Promise<Response> {
  const hint = new URL(req.url).searchParams.get('task') ?? undefined;
  const store = ctx.deps.store(ctx.caller.project.key);
  const facts = store.access(ctx.version);
  if (facts === undefined) return errorResponse('conflict', 'The deployed config version is not available.');
  const versions = ctx.deps.sync(ctx.caller.project.key).versions;
  const configFor = versions.configFor(ctx.version);
  const ports: PlanPorts = {
    clock: ctx.deps.clock,
    facts,
    geo: ctx.geo,
    limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
  };
  const available = (task: Key, target: Parameters<typeof plan.availableFor>[1]): boolean =>
    plan.availableFor(task, target, ctx.caller.actor, configFor, ports).ok;
  /** Submits the one run a write is; 204 for a change to an existing feature, 201 with a location for a create. */
  const submit = (
    task: Key,
    input: { [k: string]: Json },
    feature: FeatureId | undefined,
    existing: boolean,
  ) => {
    const run: Run = {
      id: ctx.deps.ids.runId(),
      task,
      actor: ctx.caller.actor,
      configVersion: runVersion,
      input,
      ...(feature !== undefined ? { featureId: feature } : {}),
    };
    let result;
    try {
      result = store.submit(run);
    } catch (e) {
      if (e instanceof ConfigVersionGone)
        return errorResponse('conflict', 'The config version changed; retry.');
      throw e;
    }
    if (result.outcome === 'refused') {
      const { code, message, path } = result.refusal;
      const issues = [{ path: path ?? '', message: code }];
      return errorResponse(
        permissionRefusal(ctx, code) ? 'forbidden' : 'run_refused',
        `${code}: ${message}`,
        issues,
      );
    }
    if (existing) return new Response(null, { status: 204 });
    const created = result.observations.find((o) => o.property === '$type')?.featureId;
    const location = `${ctx.base}/collections/${ctx.type}/items/${created ?? ''}`;
    return new Response(null, { status: 201, headers: { location } });
  };
  const refuse = (message: string, candidates: readonly string[], denied?: true): Response =>
    denied === true && ctx.caller.actor.kind === 'participant'
      ? errorResponse('forbidden', message, [{ path: 'task', message: 'not_available' }])
      : errorResponse(
          'no_write_task',
          message,
          candidates.map((c) => ({ path: 'task', message: c })),
        );

  const current =
    fid === undefined ? undefined : readOne(ctx.deps.db(ctx.caller.project.key), ctx.type, fid, ctx.visible);
  if (fid !== undefined && current === undefined) return errorResponse('not_found', 'No such feature.');
  const feature = fid as FeatureId | undefined;
  // The tasks of a change come from the version the feature follows: its pin, else the deployed one.
  let config: CompiledConfig;
  let runVersion: number;
  try {
    runVersion = feature === undefined ? ctx.version : versions.versionOf(feature, ctx.version);
    config = runVersion === ctx.version ? ctx.config : versions.at(runVersion).config;
  } catch (e) {
    if (e instanceof ConfigVersionGone)
      return errorResponse('conflict', 'The config version changed; retry.');
    throw e;
  }

  if (method === 'DELETE') {
    const r = resolveWriteTask(
      config,
      ctx.type,
      { kind: 'delete', feature: feature as FeatureId },
      ctx.caller.actor,
      hint,
      available,
    );
    if (!r.ok) return refuse(r.reason, r.candidates, r.denied);
    return submit(r.task, {}, feature, true);
  }

  const crs = bodyCrs(req, ctx);
  if (crs instanceof Response) return crs;
  const body = await readBody(req, BodySchema, DEFAULT_HTTP_LIMITS.maxBodyBytes);
  if (body instanceof Response) return body;

  const geoKey = primaryGeometry(ctx.config, ctx.type);
  let geometry: Geometry | undefined;
  if (body.geometry !== null) {
    if (geoKey === undefined)
      return errorResponse('invalid_body', `${ctx.type} has no geometry.`, [
        { path: 'geometry', message: 'The feature type has no geometry.' },
      ]);
    geometry = (crs === CRS84
      ? body.geometry
      : ctx.seams.crs.toWgs84(body.geometry as unknown as Geometry, crs)) as unknown as Geometry;
  }
  const values: { [k: string]: Json } = { ...(body.properties ?? {}) };
  if (geometry !== undefined && geoKey !== undefined) values[geoKey] = geometry as unknown as Json;

  let change: WriteChange;
  let input: { [k: string]: Json };
  if (current === undefined) {
    change = { kind: 'create', keys: Object.keys(values) };
    input = values;
  } else {
    const now = serializerFor(ctx.config, ctx.type, ctx.caller.actor, ctx.seams.crs, CRS84)(current);
    const was: { [k: string]: Json } = {
      ...now.properties,
      ...(geoKey !== undefined && now.geometry !== null ? { [geoKey]: now.geometry as unknown as Json } : {}),
    };
    input = Object.fromEntries(Object.entries(values).filter(([k, v]) => stable(was[k]) !== stable(v)));
    if (Object.keys(input).length === 0) return new Response(null, { status: 204 });
    change = { kind: 'update', feature: feature as FeatureId, keys: Object.keys(input) };
  }

  const resolved = resolveWriteTask(config, ctx.type, change, ctx.caller.actor, hint, available);
  if (!resolved.ok) return refuse(resolved.reason, resolved.candidates, resolved.denied);
  return submit(resolved.task, input, feature, current !== undefined);
}
