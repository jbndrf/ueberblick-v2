/**
 * The browser side of the Rollen page: one function per write, over the page's own routes (`roles` for the draft
 * edits, `roles/members` for who has a role) and the roster's `participants` route for a person typed into the picker.
 * Every answer is a `CallResult`: done, or the refusal already in the page language, so a component shows a message
 * and never reads a status.
 */
import type { CallResult, DeletePreview, RoleCall, SelfJoinState } from './types';

export type Language = 'de' | 'en';
type Fetch = typeof fetch;

export interface RolesApi {
  create(name: string, description?: string): Promise<CallResult<{ key: string }>>;
  update(key: string, patch: { name?: string; description?: string }): Promise<CallResult<{ key: string }>>;
  /** v3 "Selbstbeitritt" switch: applies at once (not part of the draft, Q14) and returns the link's slug. */
  setSelfJoin(role: string, enabled: boolean): Promise<CallResult<SelfJoinState>>;
  /** v3 "Max. Arbeitsabläufe pro Teilnehmer:in": `roles.<key>.quota` in the draft; 0 removes it. */
  setQuota(key: string, quota: number): Promise<CallResult<{ key: string }>>;
  /** What deleting these roles would break (the Doc's problems) and whom it would affect. Changes nothing. */
  preview(keys: readonly string[]): Promise<CallResult<DeletePreview>>;
  remove(keys: readonly string[]): Promise<CallResult<null>>;
  /** One change set for one role: who gets it, who loses it. */
  setMembers(role: string, add: readonly string[], remove: readonly string[]): Promise<CallResult<null>>;
  /** A person typed into the picker (v3 `createParticipant`): added to the roster with no roles yet. */
  createPerson(name: string): Promise<CallResult<{ id: string }>>;
}

interface Refusal {
  readonly message?: { readonly de?: string; readonly en?: string };
}

export function createRolesApi(opts: {
  readonly project: string;
  readonly language: Language;
  readonly fetch: Fetch;
  /** The message when the server gave none (offline, a 500). */
  readonly fallback: string;
}): RolesApi {
  const project = encodeURIComponent(opts.project);
  const page = `/admin/projects/${project}/roles`;
  const json = { 'content-type': 'application/json' };

  async function send<T>(
    url: string,
    method: string,
    body: unknown,
    read: (answer: unknown) => T,
  ): Promise<CallResult<T>> {
    try {
      const res = await opts.fetch(url, { method, headers: json, body: JSON.stringify(body) });
      const answer: unknown = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, value: read(answer) };
      return { ok: false, message: (answer as Refusal).message?.[opts.language] ?? opts.fallback };
    } catch {
      return { ok: false, message: opts.fallback };
    }
  }
  const call = <T>(body: RoleCall, read: (answer: unknown) => T) => send(page, 'POST', body, read);
  const keyOf = (a: unknown): { key: string } => ({ key: String((a as { key?: unknown }).key ?? '') });
  const nothing = (): null => null;

  return {
    create: (name, description) =>
      call({ action: 'create', name, ...(description ? { description } : {}) }, keyOf),
    update: (key, patch) => call({ action: 'update', key, ...patch }, keyOf),
    setSelfJoin: (role, enabled) =>
      send(`${page}/join`, 'PUT', { role, enabled }, (a) => {
        const r = a as { enabled?: unknown; slug?: unknown };
        return { enabled: r.enabled === true, slug: String(r.slug ?? '') };
      }),
    setQuota: (key, quota) => call({ action: 'quota', key, quota }, keyOf),
    preview: (keys) => call({ action: 'uses', keys }, (a) => a as DeletePreview),
    remove: (keys) => call({ action: 'delete', keys }, nothing),
    setMembers: (role, add, remove) => send(`${page}/members`, 'PUT', { role, add, remove }, nothing),
    createPerson: (name) =>
      send(`/api/admin/p/${project}/participants`, 'POST', { name, roles: [] }, (a) => ({
        id: String((a as { id?: unknown }).id ?? ''),
      })),
  };
}
