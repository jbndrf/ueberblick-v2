/**
 * The participant roster behind v3's Teilnehmende table (WP-168, WP-310), as plain functions over the project database.
 *
 * R3 choice: a roster change is a direct admin write, like `memberships` (`admin/bootstrap.ts`), not a run. A
 * participant is an identity with roles, not a feature; `core.plan` has no feature to change and the roster is not part
 * of `core.fold`. Changes apply at once and are not part of the builder draft (Q13). Removing never deletes: runs name
 * the actor and an unknown id would otherwise authenticate with no roles (A-014, A-025).
 */
import { randomBytes } from 'node:crypto';
import { KeySchema, type Key } from '@ueberblick/core';
import type { Auth } from '../../auth/contract';
import type { Db } from '../../db/driver';
import type { TemplateSource } from '../../deploy/contract';
import { checkColumns, FIXED_ATTRS, type AttrValue, type Attrs } from './columns';
import type { ParticipantErrorCode } from './registry';
import { knownRoles } from './roles';

export interface ParticipantsCtx {
  /** The project database: the `participants` roster. */
  readonly db: Db;
  /** The control database: the self-join links of the project's roles (WP-639). */
  readonly control: Db;
  readonly auth: Auth;
  readonly projectId: string;
  readonly now: () => Date;
  /** Resolves the template of the draft, so its roles count as known. Without it only the overlay's roles do. */
  readonly templates?: TemplateSource;
}

/** What the roster functions that touch only the project database need (imports use this). */
export type RosterCtx = Pick<ParticipantsCtx, 'db' | 'now' | 'templates'>;

export type Failure = {
  readonly ok: false;
  readonly code: ParticipantErrorCode;
  /** The role or column the refusal is about, for the message. */
  readonly detail?: string;
};
export type Done = { readonly ok: true } | Failure;

export interface RosterEntry {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly roles: readonly Key[];
  /** The values of the project's custom columns. */
  readonly attrs: Attrs;
  /** A guest who joined by themselves (the "Gäste anzeigen" marker). */
  readonly selfJoined: boolean;
  readonly createdAt: string | null;
  readonly disabledAt: string | null;
}

export interface NewParticipant {
  readonly name: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly roles: readonly string[];
  /** Values of the custom columns. */
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly selfJoined?: boolean;
}

export interface ParticipantPatch {
  readonly name?: string;
  /** `null` clears. */
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly roles?: readonly string[];
  /** Custom column values laid over the stored ones; `null` clears one. */
  readonly attrs?: Readonly<Record<string, unknown>>;
}

const ID = /^[A-Za-z0-9._@-]{1,100}$/;
export const fail = (code: ParticipantErrorCode, detail?: string): Failure => ({
  ok: false,
  code,
  ...(detail !== undefined ? { detail } : {}),
});

export const row = (db: Db, id: string) =>
  db.prepare<{ disabled_at: string | null }>('SELECT disabled_at FROM participants WHERE id = ?').get(id);

/** Role keys: well-formed, and (when the project has a role list) known. */
function checkRoles(ctx: RosterCtx, roles: readonly string[], known: boolean): readonly Key[] | Failure {
  const out: Key[] = [];
  for (const r of roles) {
    if (!KeySchema.safeParse(r).success) return fail('invalid_role', r);
    out.push(r as Key);
  }
  if (known) {
    const have = knownRoles(ctx.db, ctx.templates);
    const unknown = have && out.find((r) => !have.has(r));
    if (unknown !== undefined) return fail('unknown_role', unknown);
  }
  return [...new Set(out)];
}

const emailOk = (e: string): boolean => e.includes('@');

/** A short readable id from the name: ASCII slug plus a random suffix (never typed by the admin). */
export function generateId(name: string, taken: (id: string) => boolean): string {
  const slug =
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/, '') || 'teilnehmer';
  for (;;) {
    const id = `${slug}-${randomBytes(3).toString('hex')}`;
    if (!taken(id)) return id;
  }
}

function insert(ctx: RosterCtx, id: string, input: NewParticipant, known: boolean): Done {
  const name = input.name.trim();
  if (name === '') return fail('name_required');
  if (input.email && !emailOk(input.email)) return fail('invalid_email');
  const roles = checkRoles(ctx, input.roles, known);
  if (!Array.isArray(roles)) return roles as Failure;
  const custom = checkColumns(ctx.db, input.attrs ?? {});
  if (!custom.ok) return fail(custom.code, custom.detail);
  const attrs: Record<string, AttrValue> = { ...custom.attrs };
  if (input.email) attrs['email'] = input.email.trim();
  if (input.phone) attrs['phone'] = input.phone.trim();
  ctx.db
    .prepare(
      'INSERT INTO participants (id, name, roles, attrs, self_joined, created_at) VALUES (?,?,?,?,?,?)',
    )
    .run(
      id,
      name,
      JSON.stringify(roles),
      Object.keys(attrs).length > 0 ? JSON.stringify(attrs) : null,
      input.selfJoined ? 1 : 0,
      ctx.now().toISOString(),
    );
  return { ok: true };
}

/** Adds a participant with a generated id; the id is in the result. The name is required, the roles must be known. */
export function addParticipant(
  ctx: RosterCtx,
  input: NewParticipant,
): { readonly ok: true; readonly id: string } | Failure {
  const id = generateId(input.name, (c) => row(ctx.db, c) !== undefined);
  const r = insert(ctx, id, input, true);
  return r.ok ? { ok: true, id } : r;
}

/**
 * Adds a participant under an id that already exists elsewhere (a v3 migration, a seed). Same checks as
 * `addParticipant`, except that the name is optional there and roles are only checked for their syntax: an import
 * runs before the project has a deployed config.
 */
export function importParticipant(
  ctx: RosterCtx,
  input: Omit<NewParticipant, 'name'> & { readonly id: string; readonly name?: string },
): Done {
  if (!ID.test(input.id)) return fail('invalid_id');
  if (row(ctx.db, input.id)) return fail('participant_exists');
  const roles = checkRoles(ctx, input.roles, false);
  if (!Array.isArray(roles)) return roles as Failure;
  if (input.name === undefined) {
    ctx.db
      .prepare('INSERT INTO participants (id, name, roles, created_at) VALUES (?,?,?,?)')
      .run(input.id, null, JSON.stringify(roles), ctx.now().toISOString());
    return { ok: true };
  }
  return insert(ctx, input.id, { ...input, name: input.name }, false);
}

interface Stored {
  name: string | null;
  roles: string;
  attrs: string | null;
}

/** Changes the given fields; a role change applies on the participant's next request. Required columns stay filled. */
export function updateParticipant(ctx: RosterCtx, id: string, patch: ParticipantPatch): Done {
  const cur = ctx.db.prepare<Stored>('SELECT name, roles, attrs FROM participants WHERE id = ?').get(id);
  if (!cur) return fail('participant_unknown');
  const sets: [string, string | null][] = [];
  if (patch.name !== undefined) {
    if (patch.name.trim() === '') return fail('name_required');
    sets.push(['name', patch.name.trim()]);
  }
  if (patch.roles !== undefined) {
    const roles = checkRoles(ctx, patch.roles, true);
    if (!Array.isArray(roles)) return roles as Failure;
    sets.push(['roles', JSON.stringify(roles)]);
  }
  if (patch.attrs !== undefined || patch.email !== undefined || patch.phone !== undefined) {
    const all = (cur.attrs === null ? {} : JSON.parse(cur.attrs)) as Record<string, AttrValue>;
    const fixed = new Map<string, AttrValue>();
    const custom: Record<string, AttrValue> = {};
    for (const [k, v] of Object.entries(all)) {
      if ((FIXED_ATTRS as readonly string[]).includes(k)) fixed.set(k, v);
      else custom[k] = v;
    }
    for (const k of FIXED_ATTRS) {
      const v = patch[k];
      if (v === undefined) continue;
      if (k === 'email' && v !== null && v !== '' && !emailOk(v)) return fail('invalid_email');
      if (v === null || v.trim() === '') fixed.delete(k);
      else fixed.set(k, v.trim());
    }
    const checked = checkColumns(ctx.db, patch.attrs ?? {}, custom);
    if (!checked.ok) return fail(checked.code, checked.detail);
    const merged = { ...checked.attrs, ...Object.fromEntries(fixed) };
    sets.push(['attrs', Object.keys(merged).length > 0 ? JSON.stringify(merged) : null]);
  }
  for (const [col, v] of sets) ctx.db.prepare(`UPDATE participants SET ${col} = ? WHERE id = ?`).run(v, id);
  return { ok: true };
}

/** Switches the participant off (v3's Status): their sessions and token exchanges are refused until `enable`. */
export function disableParticipant(ctx: RosterCtx, id: string): Done {
  if (!row(ctx.db, id)) return fail('participant_unknown');
  ctx.db
    .prepare('UPDATE participants SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL')
    .run(ctx.now().toISOString(), id);
  return { ok: true };
}

/** Switches the participant on again (and brings a removed one back into the list); their tokens work again. */
export function enableParticipant(ctx: RosterCtx, id: string): Done {
  if (!row(ctx.db, id)) return fail('participant_unknown');
  ctx.db.prepare('UPDATE participants SET disabled_at = NULL, hidden = 0 WHERE id = ?').run(id);
  return { ok: true };
}

/** Disables and hides the participant, revokes their QR logins and ends their sessions. The row stays: runs name the actor. */
export function removeParticipant(ctx: RosterCtx & { auth: Auth; projectId: string }, id: string): Done {
  if (!row(ctx.db, id)) return fail('participant_unknown');
  ctx.db
    .prepare('UPDATE participants SET hidden = 1, disabled_at = COALESCE(disabled_at, ?) WHERE id = ?')
    .run(ctx.now().toISOString(), id);
  ctx.auth.revokeParticipant(ctx.projectId, id);
  return { ok: true };
}

interface ListRow {
  id: string;
  name: string | null;
  roles: string;
  attrs: string | null;
  self_joined: number;
  created_at: string | null;
  disabled_at: string | null;
}

/** The visible roster in id order, from one query. `guests: false` hides the self-joined; removed ones are never listed. */
export function listParticipants(
  ctx: Pick<RosterCtx, 'db'>,
  opts: { readonly guests: boolean } = { guests: true },
): readonly RosterEntry[] {
  return ctx.db
    .prepare<ListRow>(
      `SELECT id, name, roles, attrs, self_joined, created_at, disabled_at FROM participants
        WHERE hidden = 0 ${opts.guests ? '' : 'AND self_joined = 0'} ORDER BY id`,
    )
    .all()
    .map((r) => {
      const { email, phone, ...custom } = (r.attrs === null ? {} : JSON.parse(r.attrs)) as Record<
        string,
        AttrValue
      >;
      return {
        id: r.id,
        name: r.name,
        email: typeof email === 'string' ? email : null,
        phone: typeof phone === 'string' ? phone : null,
        roles: JSON.parse(r.roles) as Key[],
        attrs: custom,
        selfJoined: r.self_joined === 1,
        createdAt: r.created_at,
        disabledAt: r.disabled_at,
      };
    });
}
