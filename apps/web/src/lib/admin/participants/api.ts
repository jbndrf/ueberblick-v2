/**
 * The browser side of the Teilnehmende page: one function per write, over the admin routes of WP-310 and WP-607
 * (`/api/admin/p/<project>/participants…`) and the page's own `roles` route. Every answer is a `CallResult`: done, or
 * the server's refusal already in the page language, so a component shows a message and never reads a status.
 */
import type { CallResult, CustomColumn, RoleOption } from './types';

export type Language = 'de' | 'en';
type Fetch = typeof fetch;

export interface NewPerson {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly roles: readonly string[];
  readonly attrs?: Readonly<Record<string, unknown>>;
}

export interface PersonPatch {
  readonly name?: string;
  /** `null` clears. */
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly roles?: readonly string[];
  readonly attrs?: Readonly<Record<string, unknown>>;
  /** Switches the person off (true) or on (false). */
  readonly disabled?: boolean;
}

export interface ParticipantsApi {
  add(person: NewPerson): Promise<CallResult<{ id: string }>>;
  patch(id: string, patch: PersonPatch): Promise<CallResult<null>>;
  remove(id: string): Promise<CallResult<null>>;
  /** Sets the chosen token, or generates one when `token` is absent (WP-607). */
  setToken(id: string, token?: string): Promise<CallResult<{ token: string }>>;
  revokeToken(id: string): Promise<CallResult<null>>;
  saveColumns(columns: readonly CustomColumn[]): Promise<CallResult<null>>;
  /** A role typed in a Rollen cell: added to the draft (Q13). */
  createRole(name: string): Promise<CallResult<RoleOption>>;
}

interface Refusal {
  readonly error?: unknown;
  readonly message?: { readonly de?: string; readonly en?: string };
}

export function createParticipantsApi(opts: {
  readonly project: string;
  readonly language: Language;
  readonly fetch: Fetch;
  /** The message when the server gave none (offline, a 500). */
  readonly fallback: string;
}): ParticipantsApi {
  const base = `/api/admin/p/${encodeURIComponent(opts.project)}/participants`;
  const at = (id: string): string => `${base}/${encodeURIComponent(id)}`;
  const json = { 'content-type': 'application/json' };

  async function send<T>(
    url: string,
    method: string,
    body: unknown,
    read: (answer: unknown) => T,
  ): Promise<CallResult<T>> {
    try {
      const res = await opts.fetch(url, {
        method,
        ...(body === undefined ? {} : { headers: json, body: JSON.stringify(body) }),
      });
      const answer: unknown = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, value: read(answer) };
      const refusal = answer as Refusal;
      return { ok: false, message: refusal.message?.[opts.language] ?? opts.fallback };
    } catch {
      return { ok: false, message: opts.fallback };
    }
  }
  const nothing = (): null => null;

  return {
    add: (p) =>
      send(base, 'POST', { ...p, roles: [...p.roles] }, (a) => ({
        id: String((a as { id?: unknown }).id ?? ''),
      })),
    patch: (id, patch) => send(at(id), 'PATCH', patch, nothing),
    remove: (id) => send(at(id), 'DELETE', undefined, nothing),
    setToken: (id, token) =>
      send(`${at(id)}/credentials`, 'PUT', token === undefined ? {} : { token }, (a) => ({
        token: String((a as { token?: unknown }).token ?? ''),
      })),
    revokeToken: (id) => send(`${at(id)}/credentials`, 'DELETE', undefined, nothing),
    saveColumns: (columns) => send(`${base}/columns`, 'PUT', { columns }, nothing),
    createRole: (name) =>
      send(
        `/admin/projects/${encodeURIComponent(opts.project)}/participants/roles`,
        'POST',
        { name },
        (a) => {
          const role = (a as { role?: RoleOption }).role;
          if (!role) throw new Error('no role in the answer');
          return role;
        },
      ),
  };
}
