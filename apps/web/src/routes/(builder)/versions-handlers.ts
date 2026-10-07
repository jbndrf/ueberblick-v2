import type { DeployOutcome, Mapping, VersionsSnapshot } from '@ueberblick/builder';
import type { PublishOutcome, TemplateFile } from '@ueberblick/core';
import type { Principal, VersionChoices } from '@ueberblick/server';
import type { DeployPlan } from '../../lib/admin/deploy/types';
import type { PlanOptions } from './builder-versions';
import { isRecord, json, type Call } from '../../lib/server/handlers/http';
import { parseMappings } from '../../lib/admin/deploy/mappings';

/** Bodies here are a template or an overlay as text; a megabyte is far above any real one. */
export const MAX_BODY_BYTES = 1_000_000;

/** What the handlers need of the Versions service (`routes/(builder)/builder-versions.ts`); tests pass fakes. */
export interface VersionsPort {
  snapshot(): VersionsSnapshot;
  versionFile(version: number): TemplateFile | undefined;
  planDraft(opts: PlanOptions): DeployPlan;
  compareFiles(): { live: string | null; draft: string | null };
  deployDraft(
    by: string,
    revision: number,
    mappings: Readonly<Record<string, Mapping>>,
    choices: VersionChoices,
  ): DeployOutcome;
  rollback(by: string, version: number): DeployOutcome | undefined;
  upgrade(
    by: string,
    overlay: string,
    mappings: Readonly<Record<string, Mapping>>,
    at: string,
  ): DeployOutcome;
}

export interface VersionsDeps {
  authorize(
    principal: Principal | null,
    project: string,
  ): { readonly projectKey: string; readonly principal: Principal } | Response;
  service(project: string): VersionsPort;
  publish(source: string): PublishOutcome;
  now(): string;
}

type Auth = { readonly projectKey: string; readonly principal: Principal };

/**
 * The deploy choice per Objektart (WP-317): a JSON object of type to choice. An unknown choice name is a typed problem of the
 * engine, a value that is not an object is refused here.
 */
export function parseChoices(v: unknown): VersionChoices | undefined {
  if (v === undefined) return {};
  if (!isRecord(v)) return undefined;
  return Object.values(v).every((c) => typeof c === 'string') ? (v as VersionChoices) : undefined;
}

const STATUS: Record<string, number> = { problems: 422, mapping_required: 409, stale: 409, failed: 500 };
const outcome = (o: DeployOutcome): Response => json(o, o.ok ? 200 : (STATUS[o.reason] ?? 500));

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return json({ code: 'too_large', error: 'The request is too large.' }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    return json({ code: 'too_large', error: 'The request is too large.' }, 413);
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value)) return value;
  } catch {
    // falls through to the 400 below
  }
  return json({ code: 'bad_request', error: 'The request body must be a JSON object.' }, 400);
}
const bad = (error: string): Response => json({ code: 'bad_request', error }, 400);

/**
 * The Versions routes under `/builder-api/<project>/` (docs/08). Every one needs an admin of the
 * project (A-008). Deploying is always an explicit POST: a lens, an assistant or the MCP server (H4)
 * may prepare a plan, and a human decision sends this call.
 */
export function createVersionsHandlers(deps: VersionsDeps) {
  const admin = (call: Pick<Call, 'params' | 'locals'>): Auth | Response =>
    deps.authorize(call.locals.admin, call.params['project'] ?? '');

  return {
    GET(call: Pick<Call, 'params' | 'locals'>): Response {
      const auth = admin(call);
      if (auth instanceof Response) return auth;
      return json(deps.service(auth.projectKey).snapshot());
    },

    GET_VERSION(call: Pick<Call, 'params' | 'locals'>): Response {
      const auth = admin(call);
      if (auth instanceof Response) return auth;
      const n = Number(call.params['version']);
      const file = Number.isInteger(n) ? deps.service(auth.projectKey).versionFile(n) : undefined;
      return file ? json(file) : json({ code: 'no_version', error: 'There is no such version.' }, 404);
    },

    /** A dry run of the saved draft (H4: a lens or an assistant may plan; only a human deploys). */
    PLAN(call: Pick<Call, 'params' | 'locals' | 'request'>): Response {
      const auth = admin(call);
      if (auth instanceof Response) return auth;
      const query = new URL(call.request.url).searchParams;
      let raw: unknown;
      try {
        raw = query.has('versions') ? JSON.parse(query.get('versions') ?? '') : undefined;
      } catch {
        return bad('`versions` must be a JSON object of type to choice.');
      }
      const choices = parseChoices(raw);
      if (choices === undefined) return bad('`versions` must be a JSON object of type to choice.');
      return json(deps.service(auth.projectKey).planDraft({ choices, locale: query.get('locale') ?? 'en' }));
    },

    /** The project file live and as draft, as YAML text, for the line diff of the deploy overview (WP-506). */
    COMPARE(call: Pick<Call, 'params' | 'locals'>): Response {
      const auth = admin(call);
      if (auth instanceof Response) return auth;
      return json(deps.service(auth.projectKey).compareFiles());
    },

    async DEPLOY(call: Pick<Call, 'params' | 'locals' | 'request'>): Promise<Response> {
      const auth = admin(call);
      if (auth instanceof Response) return auth;
      const body = await readBody(call.request);
      if (body instanceof Response) return body;
      const mappings = parseMappings(body['mappings']);
      const choices = parseChoices(body['versions']);
      if (!Number.isInteger(body['revision']) || mappings === undefined || choices === undefined)
        return bad(
          'Send { "revision": integer, "mappings": { <path>: { "to": key } | { "discard": true } }, "versions": { <type>: "keep" | "move" } }.',
        );
      return outcome(
        deps
          .service(auth.projectKey)
          .deployDraft(auth.principal.id, body['revision'] as number, mappings, choices),
      );
    },

    async ROLLBACK(call: Pick<Call, 'params' | 'locals' | 'request'>): Promise<Response> {
      const auth = admin(call);
      if (auth instanceof Response) return auth;
      const body = await readBody(call.request);
      if (body instanceof Response) return body;
      if (!Number.isInteger(body['version'])) return bad('Send { "version": integer }.');
      const r = deps.service(auth.projectKey).rollback(auth.principal.id, body['version'] as number);
      return r ? outcome(r) : json({ code: 'no_version', error: 'There is no such version.' }, 404);
    },

    async UPGRADE(call: Pick<Call, 'params' | 'locals' | 'request'>): Promise<Response> {
      const auth = admin(call);
      if (auth instanceof Response) return auth;
      const body = await readBody(call.request);
      if (body instanceof Response) return body;
      const mappings = parseMappings(body['mappings']);
      if (typeof body['overlay'] !== 'string' || mappings === undefined)
        return bad('Send { "overlay": text, "mappings": { ... } }.');
      return outcome(
        deps.service(auth.projectKey).upgrade(auth.principal.id, body['overlay'], mappings, deps.now()),
      );
    },

    async PUBLISH(call: Pick<Call, 'params' | 'locals' | 'request'>): Promise<Response> {
      const auth = admin(call);
      if (auth instanceof Response) return auth;
      const body = await readBody(call.request);
      if (body instanceof Response) return body;
      if (typeof body['template'] !== 'string') return bad('Send { "template": text }.');
      const r = deps.publish(body['template']);
      return json(r, r.ok ? 200 : r.reason === 'refused' ? 409 : r.reason === 'invalid' ? 422 : 500);
    },
  };
}
