/**
 * The browser side of the data page's ⋮ menu: one call over the page's own form action (`?/menu`, v3's `?/duplicate`,
 * `?/importFromProject` and `?/deleteWorkflow`). Every answer is a `MenuResult`: the answer, or the refusal already in the
 * page language, so a component shows a message and never reads a status.
 */
import type { MenuAnswer, MenuCall, MenuResult } from './menu-types';

type Fetch = typeof fetch;
type Language = 'de' | 'en';
/** `deserialize` of `$app/forms`: the wire format of an action's answer. */
type Deserialize = (text: string) => { type: string; data?: unknown };

interface Refusal {
  readonly message?: { readonly de?: string; readonly en?: string };
}

export interface MenuApi {
  call(call: MenuCall): Promise<MenuResult>;
}

export function createMenuApi(opts: {
  readonly project: string;
  readonly type: string;
  readonly language: Language;
  readonly fetch: Fetch;
  readonly deserialize: Deserialize;
  /** The message when the server gave none (offline, a 500). */
  readonly fallback: string;
}): MenuApi {
  const url = `/admin/projects/${encodeURIComponent(opts.project)}/types/${encodeURIComponent(opts.type)}?/menu`;
  const failed = (message?: string): MenuResult => ({ ok: false, message: message ?? opts.fallback });
  return {
    async call(call) {
      try {
        const body = new FormData();
        body.set('call', JSON.stringify(call));
        const res = await opts.fetch(url, {
          method: 'POST',
          headers: { 'x-sveltekit-action': 'true' },
          body,
        });
        const answer = opts.deserialize(await res.text());
        if (answer.type === 'success') return { ok: true, answer: answer.data as MenuAnswer };
        return failed((answer.data as Refusal | undefined)?.message?.[opts.language]);
      } catch {
        return failed();
      }
    },
  };
}
