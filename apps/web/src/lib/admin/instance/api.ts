/**
 * The browser side of the instance-settings page: one function per write on `/api/instance/*` (WP-638, admin only).
 * Every answer is a `Result`: done, or a reason (and for a refusal made here, a message in the page language), so a component never reads a status (R3: the
 * writes are the API's, there is no second store).
 */
import { SLUG, type InstanceSettingsView, type PageValues } from './model';

/**
 * Done, refused here with a message in the page language (`refused`: a taken or invalid slug, nothing was sent), or
 * failed (the call did not go through; the component says which action failed).
 */
export type Result =
  | { readonly ok: true }
  | { readonly ok: false; readonly refused: true; readonly message: string }
  | { readonly ok: false; readonly refused: false };
type Fetch = typeof fetch;
const FAILED: Result = { ok: false, refused: false };

export interface InstanceApi {
  saveSettings(settings: InstanceSettingsView): Promise<Result>;
  /** Creates a page. A taken slug is refused by the API (409, create-only; v3's unique index refused it). */
  createPage(values: PageValues): Promise<Result>;
  /** Saves a page; a changed slug is one atomic move on the API (PATCH), refused when the new slug is another page. */
  updatePage(oldSlug: string, values: PageValues): Promise<Result>;
  deletePage(slug: string): Promise<Result>;
}

export interface InstanceApiOptions {
  readonly fetch: Fetch;
  readonly messages: { readonly slugTaken: string; readonly slugInvalid: string };
}

export function createInstanceApi(opts: InstanceApiOptions): InstanceApi {
  const { messages } = opts;
  const call = async (url: string, method: string, body?: unknown): Promise<Result> => {
    try {
      const res = await opts.fetch(url, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (res.ok) return { ok: true };
      return res.status === 409 ? { ok: false, refused: true, message: messages.slugTaken } : FAILED;
    } catch {
      return FAILED;
    }
  };
  const values = (v: PageValues) => ({
    title: v.title.trim(),
    body: v.body,
    sortOrder: v.sortOrder,
    showInConsentFooter: v.showInConsentFooter,
  });
  const invalid = (v: PageValues): Result | null =>
    !SLUG.test(v.slug) || v.title.trim() === ''
      ? { ok: false, refused: true, message: messages.slugInvalid }
      : null;

  return {
    saveSettings: (s) => call('/api/instance/settings', 'PUT', s),
    createPage: async (v) => invalid(v) ?? call(`/api/instance/legal/${v.slug}?create=1`, 'PUT', values(v)),
    updatePage: async (oldSlug, v) =>
      invalid(v) ??
      (v.slug === oldSlug
        ? call(`/api/instance/legal/${v.slug}`, 'PUT', values(v))
        : call(`/api/instance/legal/${oldSlug}`, 'PATCH', { ...values(v), slug: v.slug })),
    deletePage: (slug) => call(`/api/instance/legal/${slug}`, 'DELETE'),
  };
}
