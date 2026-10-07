/** The consent gate as the sign-in page uses it: what the modal shows, and the visitor's decision (WP-638). */
import type { FetchLike } from './exchange';

export interface FooterPage {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
}
export interface ConsentState {
  readonly required: boolean;
  readonly accepted: boolean;
  /** Operator text; empty means the built-in default text in the visitor's language. */
  readonly title: string;
  readonly body: string;
  readonly acceptLabel: string;
  readonly rejectLabel: string;
  readonly footerPages: readonly FooterPage[];
}

const text = (x: unknown): string => (typeof x === 'string' ? x : '');

/** The gate state, or undefined when it cannot be read (offline, bad answer): the server still enforces it. */
export async function loadConsent(fetch: FetchLike): Promise<ConsentState | undefined> {
  try {
    const res = await fetch('/api/instance/consent');
    if (!res.ok) return undefined;
    const b = (await res.json()) as Record<string, unknown>;
    const pages = Array.isArray(b['footerPages']) ? (b['footerPages'] as Record<string, unknown>[]) : [];
    return {
      required: b['required'] === true,
      accepted: b['accepted'] === true,
      title: text(b['title']),
      body: text(b['body']),
      acceptLabel: text(b['acceptLabel']),
      rejectLabel: text(b['rejectLabel']),
      footerPages: pages.map((p) => ({
        slug: text(p['slug']),
        title: text(p['title']),
        body: text(p['body']),
      })),
    };
  } catch {
    return undefined;
  }
}

/** Posts the decision; the server sets the one-year cookie. False when it did not go through. */
export async function decide(fetch: FetchLike, decision: 'accepted' | 'rejected'): Promise<boolean> {
  try {
    const res = await fetch('/api/instance/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The modal is up while the operator requires consent and this browser has not accepted. */
export const gateIsClosed = (state: ConsentState | undefined): boolean =>
  state !== undefined && state.required && !state.accepted;
