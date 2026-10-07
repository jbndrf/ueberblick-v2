/**
 * `/api/admin/p/<project>/participants` (WP-168, WP-310): the roster and the QR logins of its participants, as
 * `call -> Response` functions. The route files in apps/web only delegate here.
 *
 *   GET    participants[?guests=true]        list the roster (self-joined guests only with guests=true)
 *   POST   participants                      { name, email?, phone?, roles?, attrs? }   add; 201 { id } (generated)
 *   PATCH  participants/<id>                 { name?, email?, phone?, roles?, attrs?, disabled? }   update; disabled
 *                                            true or false switches the participant off or on (reversible)
 *   DELETE participants/<id>                 remove (disable and hide; runs keep naming the actor)
 *   GET    participants/columns              the custom column definitions
 *   PUT    participants/columns              { columns: [{ key, label, type, default?, required? }] } replaces them
 *   GET    participants/<id>/credentials     the current token: { token, link, expiresAt, lastUsedAt }
 *   PUT    participants/<id>/credentials     { token?, expiresAt? } set the chosen token or generate one (replaces)
 *   POST   participants/<id>/credentials     { expiresAt? } generate a token (the old participants page; goes with it)
 *   DELETE participants/<id>/credentials     revoke the tokens and end the participant's sessions
 *   GET    roles/self-join                   the self-join links of the roles: { links: [{ role, slug, enabled }] }
 *   PUT    roles/<role>/self-join            { enabled, slug? } switch a role's `/join/<slug>` link on or off (WP-639)
 *
 * Every call is an admin of the project (`authorizeAdmin`); a change also needs a same-origin browser request.
 * A refusal is `{ error: <code>, message: { en, de } }`. The token is readable for an admin (v3 parity, C-002),
 * returned with `no-store` and never logged.
 */
import type { Principal } from '../../auth/contract';
import { listSelfJoins, setSelfJoin } from '../../join/links';
import type { JoinErrorCode } from '../../join/registry';
import { jsonResponse } from '../shared/errors';
import { PARTICIPANT_COLUMN_TYPES, type ParticipantErrorCode } from './registry';
import { listColumns, setColumns, type ColumnDef } from './columns';
import { messageOf } from './messages';
import {
  addParticipant,
  disableParticipant,
  enableParticipant,
  removeParticipant,
  updateParticipant,
  type Done,
  type Failure,
  type ParticipantsCtx,
} from './roster';
import { currentCredential, issueQr, listRoster, revokeQrs, setCredential } from './service';

export interface ParticipantCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface ParticipantHandlerDeps {
  /** The refusing response (401, 403, 404), or the authorised project key. */
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  /** The databases and auth of the project with this key. */
  ctx(projectKey: string): ParticipantsCtx;
}

export type ParticipantHandlers = {
  readonly [
    K in
      | 'list'
      | 'add'
      | 'update'
      | 'remove'
      | 'columnsGet'
      | 'columnsSet'
      | 'credGet'
      | 'credSet'
      | 'qrIssue'
      | 'credRevoke'
      | 'selfJoinList'
      | 'selfJoinSet'
  ]: (call: ParticipantCall) => Promise<Response>;
};

const STATUS: Readonly<Record<ParticipantErrorCode, number>> = {
  invalid_id: 400,
  invalid_role: 400,
  unknown_role: 400,
  name_required: 400,
  invalid_email: 400,
  unknown_column: 400,
  column_required: 400,
  column_value_invalid: 400,
  invalid_columns: 400,
  invalid_expiry: 400,
  participant_exists: 409,
  participant_unknown: 404,
  participant_disabled: 409,
  token_duplicate: 409,
  token_too_short: 400,
  token_invalid: 400,
  credential_none: 404,
};

const JOIN_STATUS: Readonly<Record<JoinErrorCode, number>> = {
  slug_invalid: 400,
  slug_taken: 409,
  role_invalid: 400,
  link_unknown: 404,
  join_failed: 500,
};

const refuse = (f: ParticipantErrorCode | Pick<Failure, 'code' | 'detail'>): Response => {
  const { code, detail } = typeof f === 'string' ? { code: f, detail: undefined } : f;
  return jsonResponse({ error: code, message: messageOf(code, detail) }, STATUS[code]);
};
const done = (r: Done, status = 200): Response => (r.ok ? jsonResponse({}, status) : refuse(r));
const noStore = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const strings = (x: unknown): string[] | undefined =>
  Array.isArray(x) && x.every((v) => typeof v === 'string') ? (x as string[]) : undefined;

/** The E-Mail, Telefon and custom values of a body, or `undefined` when one has the wrong JSON type. */
function personFields(b: Record<string, unknown>) {
  const text = (v: unknown): string | null | undefined | false =>
    v === undefined || v === null || typeof v === 'string' ? v : false;
  const email = text(b['email']);
  const phone = text(b['phone']);
  const attrs = b['attrs'];
  if (email === false || phone === false || (attrs !== undefined && !isRecord(attrs))) return undefined;
  return {
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(attrs !== undefined ? { attrs: attrs as Record<string, unknown> } : {}),
  };
}

function columnDefs(x: unknown): ColumnDef[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: ColumnDef[] = [];
  for (const c of x) {
    if (!isRecord(c) || typeof c['key'] !== 'string' || typeof c['label'] !== 'string') return undefined;
    const type = c['type'];
    if (typeof type !== 'string' || !PARTICIPANT_COLUMN_TYPES.has(type)) return undefined;
    const d = c['default'];
    if (d !== undefined && d !== null && !['string', 'number', 'boolean'].includes(typeof d))
      return undefined;
    if (c['required'] !== undefined && typeof c['required'] !== 'boolean') return undefined;
    out.push({
      key: c['key'],
      label: c['label'],
      type,
      ...(d !== undefined && d !== null ? { default: d as string | number | boolean } : {}),
      ...(c['required'] === true ? { required: true } : {}),
    });
  }
  return out;
}

const SHAPE = {
  add: 'Expected { name: text, email?: text, phone?: text, roles?: text[], attrs?: object }.',
  update: 'Expected { name?, email?, phone?, roles?: text[], attrs?: object, disabled?: boolean }.',
  columns: 'Expected { columns: [{ key, label, type, default?, required? }] }.',
} as const;
const shapeMessage = (en: string) => ({ en, de: en });

async function body(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const v: unknown = await request.json();
    if (isRecord(v)) return v;
  } catch {
    // falls through to the 400
  }
  return jsonResponse({ error: 'The request body must be a JSON object.' }, 400);
}

export function createParticipantHandlers(deps: ParticipantHandlerDeps): ParticipantHandlers {
  /** Authorises, then (for a change) insists on a same-origin browser request, then runs `fn`. */
  const guarded =
    (
      change: boolean,
      fn: (ctx: ParticipantsCtx, call: ParticipantCall, id: string) => Promise<Response> | Response,
    ) =>
    async (call: ParticipantCall): Promise<Response> => {
      const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      if (change && call.request.headers.get('sec-fetch-site') !== 'same-origin')
        return jsonResponse({ error: 'A change must come from the admin app (same origin).' }, 403);
      return fn(deps.ctx(auth.projectKey), call, call.params['id'] ?? '');
    };

  return {
    list: guarded(false, (ctx, call) =>
      jsonResponse({
        participants: listRoster(ctx, {
          guests: new URL(call.request.url).searchParams.get('guests') === 'true',
        }),
      }),
    ),

    add: guarded(true, async (ctx, call) => {
      const b = await body(call.request);
      if (b instanceof Response) return b;
      const parsed = personFields(b);
      const roles = strings(b['roles']) ?? (b['roles'] === undefined ? [] : undefined);
      if (parsed === undefined || roles === undefined || typeof b['name'] !== 'string')
        return jsonResponse({ error: SHAPE.add, message: shapeMessage(SHAPE.add) }, 400);
      const r = addParticipant(ctx, { ...parsed, name: b['name'], roles });
      return r.ok ? jsonResponse({ id: r.id }, 201) : refuse(r);
    }),

    update: guarded(true, async (ctx, call, id) => {
      const b = await body(call.request);
      if (b instanceof Response) return b;
      const parsed = personFields(b);
      const roles = strings(b['roles']);
      const { name, disabled } = b;
      if (
        parsed === undefined ||
        (b['roles'] !== undefined && roles === undefined) ||
        (name !== undefined && typeof name !== 'string') ||
        (disabled !== undefined && typeof disabled !== 'boolean')
      )
        return jsonResponse({ error: SHAPE.update, message: shapeMessage(SHAPE.update) }, 400);
      const changed = updateParticipant(ctx, id, {
        ...parsed,
        ...(roles !== undefined ? { roles } : {}),
        ...(name !== undefined ? { name: name as string } : {}),
      });
      if (!changed.ok || disabled === undefined) return done(changed);
      return done(disabled ? disableParticipant(ctx, id) : enableParticipant(ctx, id));
    }),

    remove: guarded(true, (ctx, _call, id) => done(removeParticipant(ctx, id))),

    columnsGet: guarded(false, (ctx) => jsonResponse({ columns: listColumns(ctx.db) })),

    columnsSet: guarded(true, async (ctx, call) => {
      const b = await body(call.request);
      if (b instanceof Response) return b;
      const defs = columnDefs(b['columns']);
      if (defs === undefined)
        return jsonResponse({ error: SHAPE.columns, message: shapeMessage(SHAPE.columns) }, 400);
      const r = setColumns(ctx.db, defs);
      return r.ok ? jsonResponse({ columns: listColumns(ctx.db) }) : refuse(r);
    }),

    credGet: guarded(false, (ctx, _call, id) => {
      const r = currentCredential(ctx, id);
      return r.ok ? noStore(r.credential, 200) : refuse(r.code);
    }),

    credSet: guarded(true, async (ctx, call, id) => {
      const text = await call.request.text();
      let token: string | undefined;
      let expiresAt: string | null | undefined;
      if (text !== '') {
        const b = await body(new Request('http://x/', { method: 'PUT', body: text }));
        if (b instanceof Response) return b;
        const e = b['expiresAt'];
        if (
          (b['token'] !== undefined && typeof b['token'] !== 'string') ||
          (e !== undefined && e !== null && typeof e !== 'string')
        )
          return jsonResponse({ error: 'Expected { token?: text, expiresAt?: text | null }.' }, 400);
        token = b['token'] as string | undefined;
        expiresAt = e as string | null | undefined;
      }
      const r = setCredential(ctx, id, {
        ...(token !== undefined ? { token } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
      return r.ok ? noStore(r.credential, 200) : refuse(r.code);
    }),

    qrIssue: guarded(true, async (ctx, call, id) => {
      const text = await call.request.text();
      let expiresAt: string | undefined;
      if (text !== '') {
        const b = await body(new Request('http://x/', { method: 'POST', body: text }));
        if (b instanceof Response) return b;
        if (b['expiresAt'] !== undefined && typeof b['expiresAt'] !== 'string')
          return jsonResponse({ error: 'Expected { expiresAt?: text }.' }, 400);
        expiresAt = b['expiresAt'] as string | undefined;
      }
      const r = issueQr(ctx, id, expiresAt);
      if (!r.ok) return refuse(r.code);
      return noStore({ token: r.token, expiresAt: r.expiresAt }, 201);
    }),

    credRevoke: guarded(true, (ctx, _call, id) => done(revokeQrs(ctx, id))),

    selfJoinList: guarded(false, (ctx) => jsonResponse({ links: listSelfJoins(ctx.control, ctx.projectId) })),

    selfJoinSet: guarded(true, async (ctx, call) => {
      const b = await body(call.request);
      if (b instanceof Response) return b;
      const slug = b['slug'];
      if (typeof b['enabled'] !== 'boolean' || (slug !== undefined && typeof slug !== 'string'))
        return jsonResponse({ error: 'Expected { enabled: true | false, slug?: text }.' }, 400);
      const r = setSelfJoin(ctx, ctx.projectId, call.params['role'] ?? '', {
        enabled: b['enabled'],
        ...(slug !== undefined ? { slug: slug as string } : {}),
      });
      return r.ok ? jsonResponse(r.selfJoin) : jsonResponse({ error: r.code }, JOIN_STATUS[r.code]);
    }),
  };
}
