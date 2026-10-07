/**
 * `GET | PATCH | DELETE /api/p/<project>/prefs` (WP-612): the caller's personal preference record, per project.
 *
 * - GET: `{ entries, prefs }`: the stamped store (what a device merges with) and the nested record (what the UI reads).
 * - PATCH `{ entries: [{ path, value, at }] }`: merged last-write-wins per key; answers like GET. 400 for an unknown key
 *   or a wrong type (nothing is written), 413 for a record over the key cap.
 * - DELETE `?participant=<id>`: an admin of the project resets that person's record. 403 for a participant.
 *
 * `at` is the client time of the edit; a time more than `FUTURE_SKEW_MS` ahead of the server is cut back to the server
 * time plus that skew, so a wrong clock cannot pin a key forever.
 */
import {
  PREF_INSTANT,
  PREF_MAX_ENTRIES,
  isJson,
  prefsOf,
  validatePrefValue,
  type Clock,
  type PrefEntry,
  type PrefStore,
} from '@ueberblick/core';
import { z } from '@ueberblick/core/zod';
import type { Db } from '../../db/driver';
import { PrefsFull, createPrefsStore, type PrefsStore } from '../../prefs';
import { authorizeProject, DEVICE_KINDS } from '../shared/access';
import { readBody } from '../shared/body';
import type { Handler, Issue, ProjectAccessDeps } from '../shared/contract';
import { errorResponse, jsonResponse } from '../shared/errors';
import { withParticipant } from '../shared/session-participant';

export interface PrefsDeps extends ProjectAccessDeps {
  readonly clock: Clock;
  projectDb(key: string): Db;
}

type Params = { readonly project: string };

export interface PrefsHandlers {
  readonly get: Handler<Params>;
  readonly patch: Handler<Params>;
  readonly remove: Handler<Params>;
}

const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;

const Body = z.strictObject({
  entries: z
    .array(
      z.strictObject({
        path: z.string().max(200),
        value: z.custom<PrefEntry['value']>((v) => isJson(v), 'not a JSON value'),
        at: z.string().regex(PREF_INSTANT),
      }),
    )
    .max(PREF_MAX_ENTRIES),
});

const reply = (entries: PrefStore, participant: string): Response =>
  withParticipant(jsonResponse({ entries, prefs: prefsOf(entries) }), participant);

export function createPrefsHandlers(deps: PrefsDeps): PrefsHandlers {
  const stores = new Map<string, PrefsStore>();
  const of = (key: string): PrefsStore => {
    let s = stores.get(key);
    if (s === undefined) stores.set(key, (s = createPrefsStore(deps.projectDb(key), deps.clock)));
    return s;
  };

  const get: PrefsHandlers['get'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    return reply(of(caller.project.key).get(caller.actor.id), caller.actor.id);
  };

  const patch: PrefsHandlers['patch'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const body = await readBody(req, Body, MAX_BODY_BYTES);
    if (body instanceof Response) return body;
    const issues: Issue[] = [];
    body.entries.forEach((e, i) => {
      const v = validatePrefValue(e.path, e.value);
      if (!v.ok) issues.push({ path: `entries.${i}`, message: v.message });
    });
    if (issues.length > 0) return errorResponse('invalid_body', 'A preference is not valid.', issues);
    const ceiling = new Date(Date.parse(deps.clock.now()) + FUTURE_SKEW_MS).toISOString();
    const entries = body.entries.map((e) => (e.at > ceiling ? { ...e, at: ceiling } : e));
    try {
      return reply(of(caller.project.key).patch(caller.actor.id, entries), caller.actor.id);
    } catch (e) {
      if (e instanceof PrefsFull) return errorResponse('payload_too_large', e.message);
      throw e;
    }
  };

  const remove: PrefsHandlers['remove'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    if (caller.actor.kind !== 'admin')
      return errorResponse('forbidden', 'Only an admin may reset preferences.');
    const who = new URL(req.url).searchParams.get('participant');
    if (who === null || who === '')
      return errorResponse('invalid_query', 'The query parameter "participant" is required.');
    of(caller.project.key).remove(who);
    return new Response(null, { status: 204 });
  };

  return { get, patch, remove };
}
