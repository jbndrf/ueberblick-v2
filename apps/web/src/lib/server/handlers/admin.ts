import { parseProjectFile } from '@ueberblick/core';
import {
  createParticipantHandlers,
  deployProject,
  movePins,
  plan,
  planPinMove,
  versions,
  type VersionChoices,
} from '@ueberblick/server';
import { pinMoveView, type RequirementsOf } from '../../admin/deploy/pin-move-view';
import { parseMappings } from '../../admin/deploy/mappings';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import { isRecord, json, readJson, type Call } from './http';

/** Authorises, then runs `fn` with the project's database and the parsed project file (if `withFile`). */
async function admin(
  call: Call,
  fn: (project: string, by: string, file: unknown) => Response,
  withFile: boolean,
) {
  const auth = authorizeAdmin(call.locals.admin, call.params['project'] ?? '');
  if (auth instanceof Response) return auth;
  let file: unknown = undefined;
  if (withFile) {
    const body = await readJson(call.request);
    if ('response' in body) return body.response;
    const parsed = parseProjectFile(body.value);
    if (!parsed.success) return json({ error: 'Not a project file.', issues: parsed.error.issues }, 400);
    file = parsed.data;
  }
  return fn(auth.projectKey, `admin:${auth.principal.id}`, file);
}

type ProjectFile = Parameters<typeof deployProject>[1];
const deps = () => ({ clock: runtime().clock, templates: runtime().templates });

/**
 * The deploy choice per Objektart (WP-317): `?versions={"baum":"keep"}`, a JSON object of type to `keep` or `move`. The
 * body stays the project file. A malformed value is a 400; an unknown type or choice is a typed problem of the engine.
 */
function choicesOf(call: Call): VersionChoices | Response {
  const raw = new URL(call.request.url).searchParams.get('versions');
  if (raw === null) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as VersionChoices;
  } catch {
    // falls through to the 400
  }
  return json({ error: '`versions` must be a JSON object of type to choice.' }, 400);
}

/** POST: deploy a project file (template or overlay) as the project's next config version. `?versions=` carries the choice per type. */
export const deployHandler = (call: Call) =>
  admin(
    call,
    (project, by, file) => {
      const choices = choicesOf(call);
      if (choices instanceof Response) return choices;
      const r = deployProject(
        runtime().projectDb(project),
        file as ProjectFile,
        by,
        {
          ...deps(),
          pins: runtime().services.pins(project),
          afterDeploy: () => runtime().services.afterDeploy(project),
        },
        {},
        choices,
      );
      return json(r, r.ok ? 200 : 422);
    },
    true,
  );

/** POST: dry run of a deploy; writes nothing. Returns the per-type counts of the choice (`versions`). */
export const planHandler = (call: Call) =>
  admin(
    call,
    (project, _by, file) => {
      const choices = choicesOf(call);
      if (choices instanceof Response) return choices;
      const r = plan(runtime().projectDb(project), file as ProjectFile, deps(), choices);
      return json(r, r.ok ? 200 : 422);
    },
    true,
  );

/** GET: the project's config versions. */
export const versionsHandler = (call: Call) =>
  admin(call, (project) => json(versions(runtime().projectDb(project))), false);

const versionOf = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined;
};
const badVersion = () => json({ error: 'Send an integer `version` (the old version to move from).' }, 400);

/**
 * GET `?version=N&locale=de`: the dry run of "Auf aktuelle Version verschieben" (WP-368, owner P3): the differences
 * between version N and the deployed one that touch the Objekte pinned to N, as the deploy overview's shapes. Writes nothing.
 */
export const pinMovePlanHandler = (call: Call, requirementsOf: RequirementsOf) =>
  admin(
    call,
    (project) => {
      const query = new URL(call.request.url).searchParams;
      const version = versionOf(query.get('version'));
      if (version === undefined) return badVersion();
      const db = runtime().projectDb(project);
      const r = planPinMove(db, version);
      return r.ok
        ? json({ ok: true, view: pinMoveView(db, r.plan, query.get('locale') ?? 'en', requirementsOf) })
        : json({ ok: false, problems: r.problems }, 422);
    },
    false,
  );

/**
 * POST `{ version, mappings }`: moves the Objekte pinned to `version` to the deployed one: `$pin` unpin runs plus the
 * `$move` runs of the mappings, all or nothing (`movePins`). The devices hear the doorbell once after it commits.
 */
export const pinMoveHandler = async (call: Call) => {
  const auth = authorizeAdmin(call.locals.admin, call.params['project'] ?? '');
  if (auth instanceof Response) return auth;
  const body = await readJson(call.request);
  if ('response' in body) return body.response;
  const raw = isRecord(body.value) ? body.value : {};
  const version = versionOf(raw['version']);
  const mappings = parseMappings(raw['mappings']);
  if (version === undefined || mappings === undefined) return badVersion();
  const rt = runtime();
  const r = movePins(rt.projectDb(auth.projectKey), rt.services.pins(auth.projectKey), version, mappings);
  if (r.ok) rt.services.afterDeploy(auth.projectKey);
  return json(r, r.ok ? 200 : 422);
};

/** The participant roster and QR logins (WP-168): `participants`, `participants/<id>`, `participants/<id>/credentials`. */
export const participants = (() => {
  let handlers: ReturnType<typeof createParticipantHandlers> | undefined;
  return () =>
    (handlers ??= createParticipantHandlers({
      authorizeAdmin,
      ctx: (projectKey) => {
        const rt = runtime();
        const project = rt.project(projectKey);
        if (!project) throw new Error(`unknown project ${projectKey}`);
        return {
          db: rt.projectDb(projectKey),
          control: rt.control,
          auth: rt.auth,
          projectId: project.id,
          now: () => new Date(rt.clock.now()),
          templates: rt.templates,
        };
      },
    }));
})();

type Participants = ReturnType<typeof createParticipantHandlers>;
/** A SvelteKit handler that delegates to one participant handler. */
export const participantRoute =
  (name: keyof Participants) =>
  (call: Call): Promise<Response> =>
    participants()[name]({ request: call.request, params: call.params, principal: call.locals.admin });
