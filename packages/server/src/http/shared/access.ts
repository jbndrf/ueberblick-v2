import { readApiToken, readSessionCookie, type SessionKind } from '../../auth';
import type { ProjectAccessDeps, ProjectCaller } from './contract';
import { errorResponse } from './errors';
import { sessionChanged } from './session-participant';

/**
 * The session kinds an endpoint accepts, in the order it tries them. The caller states it (R1: one function, no
 * implicit global order): a device endpoint passes `DEVICE_KINDS`, so with both cookies in one browser (WP-705) a
 * participant's run is recorded as the participant, never as the admin; a route an admin never uses passes one kind.
 */
export type SessionKinds = readonly [SessionKind, ...SessionKind[]];

/** Participant-device endpoints: the participant (or API token) first, the admin session only as the fallback. */
export const DEVICE_KINDS: SessionKinds = ['participant', 'admin'];

/**
 * Who may act in project `key`: 401 without a session of an accepted kind; 403 for a participant of another project,
 * for an admin without a membership here, and for an unknown project (no way to probe which keys exist). The first
 * kind in `kinds` that may act wins, else the most telling refusal (403 before 401) answers.
 *
 * A device request that names the participant it works as (`SESSION_PARTICIPANT_HEADER`, WP-768) is refused with 409
 * `session_changed` when the session belongs to another one, before any handler reads a body or touches a store.
 * This holds for every endpoint that authorizes here (files, packs, preferences, runs, sync, ...).
 */
export function authorizeProject(
  deps: ProjectAccessDeps,
  req: Request,
  key: string,
  kinds: SessionKinds,
): ProjectCaller | Response {
  const caller = authorizeKinds(deps, req, key, kinds);
  if (caller instanceof Response) return caller;
  return sessionChanged(req, caller.actor.id) ?? caller;
}

function authorizeKinds(
  deps: ProjectAccessDeps,
  req: Request,
  key: string,
  kinds: SessionKinds,
): ProjectCaller | Response {
  let refusal: Response | null = null;
  for (const kind of kinds) {
    const answer = authorizeAs(deps, req, key, kind);
    if (!(answer instanceof Response)) return answer;
    if (refusal === null || (refusal.status === 401 && answer.status !== 401)) refusal = answer;
  }
  return refusal ?? errorResponse('unauthenticated', 'Sign in first.');
}

function authorizeAs(
  deps: ProjectAccessDeps,
  req: Request,
  key: string,
  kind: SessionKind,
): ProjectCaller | Response {
  const principal = deps.auth.authenticate(
    readSessionCookie(req, kind) ?? (kind === 'admin' ? readApiToken(req) : null),
  );
  if (principal === null || principal.kind !== kind)
    return errorResponse('unauthenticated', 'Sign in first.');
  const project = deps.project(key);
  const forbidden = (): Response => errorResponse('forbidden', 'No access to this project.');
  if (project === undefined) return forbidden();
  if (principal.kind === 'admin') {
    if (principal.projectId !== null && principal.projectId !== project.id) return forbidden(); // an admin token
    const roles = deps.auth.rolesFor(principal.id, project.id);
    if (roles.length === 0) return forbidden();
    return { project, principal, actor: { id: principal.id, kind: principal.kind, roles } };
  }
  if (principal.projectId !== project.id) return forbidden();
  return { project, principal, actor: deps.auth.toActor(principal) };
}
