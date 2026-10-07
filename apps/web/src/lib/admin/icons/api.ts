/**
 * The browser side of the Icons dialog: one call over the data page's own form action (`?/icons`, v3's
 * `?/updateIconConfig`). Every answer is an `IconResult`: the dialog's new state, or the refusal already in the page
 * language, so a component shows a message and never reads a status.
 */
import type { IconCall, IconResult, IconsState } from './types';

type Fetch = typeof fetch;
type Language = 'de' | 'en';
/** `deserialize` of `$app/forms`: the wire format of an action's answer. */
type Deserialize = (text: string) => { type: string; data?: unknown };

interface Refusal {
  readonly message?: { readonly de?: string; readonly en?: string };
}

export interface IconsApi {
  call(call: IconCall): Promise<IconResult>;
}

export function createIconsApi(opts: {
  readonly project: string;
  readonly type: string;
  readonly language: Language;
  readonly fetch: Fetch;
  readonly deserialize: Deserialize;
  /** The message when the server gave none (offline, a 500). */
  readonly fallback: string;
}): IconsApi {
  const url = `/admin/projects/${encodeURIComponent(opts.project)}/types/${encodeURIComponent(opts.type)}?/icons`;
  const failed = (message?: string): IconResult => ({ ok: false, message: message ?? opts.fallback });
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
        if (answer.type === 'success')
          return { ok: true, state: (answer.data as { state: IconsState }).state };
        return failed((answer.data as Refusal | undefined)?.message?.[opts.language]);
      } catch {
        return failed();
      }
    },
  };
}
