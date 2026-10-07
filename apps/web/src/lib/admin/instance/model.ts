/**
 * The instance-settings page's values (v3 `admin/instance/+page.server.ts`): the consent banner and the legal pages,
 * in the shapes of `GET | PUT /api/instance/settings` (WP-638). A legal page's key is its slug.
 */
export interface InstanceSettingsView {
  readonly requireConsent: boolean;
  readonly consentTitle: string;
  readonly consentBody: string;
  readonly acceptLabel: string;
  readonly rejectLabel: string;
}

export interface LegalPageView {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly sortOrder: number;
  readonly showInConsentFooter: boolean;
}

/** What the form edits for one page. */
export interface PageValues {
  readonly title: string;
  readonly slug: string;
  readonly body: string;
  readonly sortOrder: number;
  readonly showInConsentFooter: boolean;
}

/** The API's slug alphabet (`LEGAL_SLUG` in `packages/server/src/instance/store.ts`). */
export const SLUG = /^[a-z0-9-]{1,100}$/;

/**
 * v3 `slugify` (`+page.server.ts:5-12`): lower case, only a-z, 0-9 and single dashes. Done better: German umlauts
 * and ß are written out (v3 dropped them: "Über uns" became "ber-uns").
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

/** The slug a form means: the typed one, else the title's (v3 `slugify(slugInput || title)`). */
export const slugOf = (slug: string, title: string): string => slugify(slug.trim() === '' ? title : slug);

/** v3 `parseInt(sort_order) || 0`, kept to what the API takes (0 to 100000). */
export function sortOrderOf(raw: string | number): number {
  const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(100_000, Math.max(0, n)) : 0;
}

/** v3 `updateSettings`: an empty button label falls back to "Accept" / "Reject" (`+page.server.ts:177-178`). */
export const withLabelFallbacks = (s: InstanceSettingsView): InstanceSettingsView => ({
  ...s,
  consentTitle: s.consentTitle.trim(),
  acceptLabel: s.acceptLabel.trim() === '' ? 'Accept' : s.acceptLabel.trim(),
  rejectLabel: s.rejectLabel.trim() === '' ? 'Reject' : s.rejectLabel.trim(),
});
