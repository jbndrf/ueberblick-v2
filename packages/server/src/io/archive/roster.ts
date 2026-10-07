/**
 * The roster in the project ZIP (A-046, owner answer A7): the participants of the project, their custom columns and
 * their **login token as the server stores it** (the token is stored readable and unique in the whole instance,
 * `auth/service.ts`, C-002). The archive is therefore sensitive. Export reads the project database and asks the auth
 * module for each participant's current token; import goes back through the roster's own functions
 * (`importParticipant`, `setColumns`, R1) and `Auth.replaceCredential`, never a table insert (the roster is a direct
 * admin write, not a run: `http/participants/roster.ts`). Admin accounts and memberships are not part of it.
 */
import { z } from '@ueberblick/core/zod';
import type { Auth } from '../../auth/contract';
import type { Db } from '../../db/driver';
import { PARTICIPANT_COLUMN_TYPES } from '../../http/participants/registry';
import { listColumns, setColumns, type ColumnDef } from '../../http/participants/columns';
import { disableParticipant, importParticipant, removeParticipant } from '../../http/participants/roster';

/** What the exporter needs of the auth module: a participant's current token (null: none or revoked). */
export interface RosterSource {
  credential(participantId: string): { readonly token: string; readonly expiresAt: string | null } | null;
}

/** Where an import writes the roster: the new project's database and its auth module. */
export interface RosterTarget {
  readonly db: Db;
  readonly auth: Auth;
  readonly projectId: string;
  readonly now: () => Date;
}

const Attr = z.union([z.string(), z.number(), z.boolean()]);
export const ArchiveParticipantSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  roles: z.array(z.string()),
  attrs: z.record(z.string(), Attr),
  selfJoined: z.boolean(),
  createdAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
  /** A removed participant: kept because runs name the actor. */
  hidden: z.boolean(),
  login: z.object({ token: z.string(), expiresAt: z.string().nullable() }).nullable(),
});
export type ArchiveParticipant = z.infer<typeof ArchiveParticipantSchema>;

export const ArchiveColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string().refine((t) => PARTICIPANT_COLUMN_TYPES.has(t)),
  default: Attr.optional(),
  required: z.boolean().optional(),
});

const PAGE = 500;

interface Row {
  rid: number;
  id: string;
  name: string | null;
  roles: string;
  attrs: string | null;
  self_joined: number;
  created_at: string | null;
  disabled_at: string | null;
  hidden: number;
}

export const rosterCounts = (db: Db): { participants: number; columns: number } => ({
  participants: db.prepare<{ n: number }>('SELECT count(*) AS n FROM participants').get()?.n ?? 0,
  columns: listColumns(db).length,
});

export const columnsText = (db: Db): string => JSON.stringify(listColumns(db));

/** One line per participant, in keyset pages (a run may commit between two pages of a slow download, docs/12). */
export function* participantLines(db: Db, src: RosterSource): Generator<string> {
  const page = db.prepare<Row>(
    `SELECT rowid AS rid, id, name, roles, attrs, self_joined, created_at, disabled_at, hidden
       FROM participants WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`,
  );
  for (let after = 0; ;) {
    const rows = page.all(after);
    for (const r of rows) {
      const { email, phone, ...custom } = (r.attrs === null ? {} : JSON.parse(r.attrs)) as Record<
        string,
        string | number | boolean
      >;
      const credential = r.hidden === 1 ? null : src.credential(r.id);
      const line: ArchiveParticipant = {
        id: r.id,
        name: r.name,
        email: typeof email === 'string' ? email : null,
        phone: typeof phone === 'string' ? phone : null,
        roles: JSON.parse(r.roles) as string[],
        attrs: custom,
        selfJoined: r.self_joined === 1,
        createdAt: r.created_at,
        disabledAt: r.disabled_at,
        hidden: r.hidden === 1,
        login: credential === null ? null : { token: credential.token, expiresAt: credential.expiresAt },
      };
      yield JSON.stringify(line);
    }
    const last = rows[rows.length - 1];
    if (last === undefined || rows.length < PAGE) return;
    after = last.rid;
  }
}

/** True when a token appears twice inside the archive: a corrupt archive, refused (A-046). */
export function duplicateTokens(participants: readonly ArchiveParticipant[]): boolean {
  const tokens = participants.flatMap((p) => (p.login === null ? [] : [p.login.token]));
  return new Set(tokens).size !== tokens.length;
}

/** The tokens of the archive. */
export const tokensOf = (participants: readonly ArchiveParticipant[]): string[] =>
  participants.flatMap((p) => (p.login === null ? [] : [p.login.token]));

export type RosterResult =
  { readonly ok: true; readonly renewed: number } | { readonly ok: false; readonly message: string };

/**
 * Restores the columns, then each participant under its own id (so runs keep naming a known actor) and then its
 * token and expiry. A removed participant is hidden again, a disabled one disabled; a disabled participant keeps
 * its token, which signs in only after the admin enables them. A token in `inUse` (already on this instance, for
 * example the original of a copy) is **not** taken: the participant gets a fresh token from the same function the
 * Teilnehmende page uses (`replaceCredential` without a chosen token), keeping the expiry; `renewed` counts them.
 * The caller removes the project when this fails. Messages never contain a token.
 */
export function applyRoster(
  target: RosterTarget,
  columns: readonly ColumnDef[],
  participants: readonly ArchiveParticipant[],
  inUse: ReadonlySet<string>,
): RosterResult {
  const cols = setColumns(target.db, columns);
  if (!cols.ok) return { ok: false, message: `Ungültige Spalte der Teilnehmenden: ${cols.detail}.` };
  const ctx = { db: target.db, now: target.now, auth: target.auth, projectId: target.projectId };
  let renewed = 0;
  for (const p of participants) {
    const made = importParticipant(ctx, {
      id: p.id,
      roles: p.roles,
      ...(p.name !== null ? { name: p.name } : {}),
      email: p.email,
      phone: p.phone,
      attrs: p.attrs,
      selfJoined: p.selfJoined,
    });
    if (!made.ok)
      return { ok: false, message: `Teilnehmende ${p.id} konnten nicht angelegt werden (${made.code}).` };
    if (p.login !== null) {
      let r: ReturnType<Auth['replaceCredential']>;
      try {
        const collides = inUse.has(p.login.token);
        if (collides) renewed++;
        r = target.auth.replaceCredential(
          target.projectId,
          p.id,
          collides ? undefined : p.login.token,
          p.login.expiresAt ?? undefined,
        );
      } catch {
        return { ok: false, message: `Der Zugang von ${p.id} hat ein ungültiges Ablaufdatum.` };
      }
      if ('code' in r) return { ok: false, message: `Der Zugang von ${p.id} wurde abgelehnt (${r.code}).` };
    }
    if (p.hidden) removeParticipant(ctx, p.id);
    else if (p.disabledAt !== null) disableParticipant(ctx, p.id);
  }
  return { ok: true, renewed };
}
