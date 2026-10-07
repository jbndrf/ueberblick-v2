/**
 * Preview logins (WP-373, A-031 item 4, v3 "Vorschau-Logins", `fork/+page.svelte:297-312`): one preview participant per
 * role of the deployed draft plus "Keine Rolle", each with a reusable, readable token of the auth module (WP-606), link
 * `/login?token=…`. The logins follow the roles: a new role gets one on the next refresh, a removed role loses it
 * (its token is revoked and its sessions end). Tokens stay across draft saves and deploys (A-034, owner V4); a reset
 * ("Demo-Daten zurücksetzen") bumps the preview's generation, so the participants get new ids (a fresh device store)
 * and their tokens move along. Only the preview refresher calls this, with a preview's own database.
 */
import { localize, type LocalizedString } from '@ueberblick/core';
import type { Auth } from '../auth/contract';
import type { Db } from '../db/driver';

/** The slice of the auth module the logins use. */
export type PreviewLoginAuth = Pick<
  Auth,
  'issueCredential' | 'currentCredential' | 'listCredentials' | 'revokeParticipant' | 'reassignCredentials'
>;

/** A role of the deployed draft. */
export interface PreviewRole {
  readonly key: string;
  readonly label: LocalizedString | undefined;
}

/** One login as the admin sees it. `role` is null for "Keine Rolle" (the client words it). */
export interface PreviewLogin {
  readonly role: string | null;
  readonly label: string;
  readonly participantId: string;
  readonly token: string;
  /** Relative: `/login?token=<urlencoded>`; the browser adds its origin. */
  readonly link: string;
}

const ID = /^preview-g(\d+)-(?:none|r-(.+))$/;
const NONE = 'none';

/** The id of the preview participant of a role (or of "Keine Rolle") in a generation of the preview. */
export const previewParticipantId = (generation: number, role: string | null): string =>
  role === null ? `preview-g${generation}-${NONE}` : `preview-g${generation}-r-${role}`;

/** The role and generation an id was made for, or undefined for any other id. `role` null: "Keine Rolle". */
function parseId(id: string): { generation: number; role: string | null } | undefined {
  const m = ID.exec(id);
  return m ? { generation: Number(m[1]), role: m[2] ?? null } : undefined;
}

export const previewLoginLink = (token: string): string => `/login?token=${encodeURIComponent(token)}`;

interface Wanted {
  readonly role: string | null;
  readonly id: string;
  readonly name: string;
  readonly roles: readonly string[];
}

const wanted = (generation: number, roles: readonly PreviewRole[]): readonly Wanted[] => [
  ...roles.map((r) => ({
    role: r.key,
    id: previewParticipantId(generation, r.key),
    name: `Vorschau ${localize(r.label, ['de']) || r.key}`,
    roles: [r.key],
  })),
  { role: null, id: previewParticipantId(generation, null), name: 'Vorschau ohne Rolle', roles: [] },
];

/**
 * Brings the logins in line with `roles`: every wanted participant has a roster row and a live token (a token of an
 * older generation of the same role moves to it), and every preview participant or token no role asks for any more is
 * removed. Idempotent. `previewId` is the preview's id (the credentials' project id).
 */
export function syncPreviewLogins(
  auth: PreviewLoginAuth,
  db: Db,
  previewId: string,
  generation: number,
  roles: readonly PreviewRole[],
): readonly Wanted[] {
  const want = wanted(generation, roles);
  const live = auth
    .listCredentials(previewId)
    .filter((c) => c.revokedAt === null && parseId(c.participantId) !== undefined)
    .map((c) => c.participantId);
  const taken = new Set(live);
  for (const w of want) {
    if (taken.has(w.id)) continue;
    const old = live.find((id) => {
      const p = parseId(id);
      return p !== undefined && p.generation !== generation && p.role === w.role;
    });
    if (old !== undefined) {
      auth.reassignCredentials(previewId, old, w.id);
      taken.delete(old);
    } else auth.issueCredential(previewId, w.id);
    taken.add(w.id);
  }
  const ids = new Set(want.map((w) => w.id));
  for (const id of taken) if (!ids.has(id)) auth.revokeParticipant(previewId, id);
  db.transaction(() => {
    const put = db.prepare(
      `INSERT INTO participants (id, name, roles, attrs, disabled_at) VALUES (?, ?, ?, NULL, NULL)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, roles = excluded.roles, disabled_at = NULL`,
    );
    for (const w of want) put.run(w.id, w.name, JSON.stringify(w.roles));
    for (const row of db.prepare<{ id: string }>('SELECT id FROM participants').all())
      if (parseId(row.id) !== undefined && !ids.has(row.id))
        db.prepare('DELETE FROM participants WHERE id = ?').run(row.id);
  });
  return want;
}

/** The logins of a preview, in role order, "Keine Rolle" last; `labelOf` words a role for the locale. */
export function listPreviewLogins(
  auth: PreviewLoginAuth,
  previewId: string,
  generation: number,
  roles: readonly PreviewRole[],
  locale: string,
): readonly PreviewLogin[] {
  const out: PreviewLogin[] = [];
  for (const w of wanted(generation, roles)) {
    const c = auth.currentCredential(previewId, w.id);
    if (c === null) continue;
    const role = roles.find((r) => r.key === w.role);
    out.push({
      role: w.role,
      label: role === undefined ? '' : localize(role.label, [locale]) || role.key,
      participantId: w.id,
      token: c.token,
      link: previewLoginLink(c.token),
    });
  }
  return out;
}
