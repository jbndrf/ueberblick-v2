import type { Clock } from '@ueberblick/core';
import type { Db } from '../db/driver';

/** The consent gate's configuration (v3 `instance_settings`). Empty text means "use the built-in default text". */
export interface InstanceSettings {
  readonly requireConsent: boolean;
  readonly consentTitle: string;
  readonly consentBody: string;
  readonly acceptLabel: string;
  readonly rejectLabel: string;
}

export interface LegalPageInput {
  readonly slug: string;
  readonly title: string;
  /** HTML; the reader sanitises it (v3 `sanitizeHtml`). */
  readonly body: string;
  readonly sortOrder: number;
  readonly showInConsentFooter: boolean;
}
export interface LegalPage extends LegalPageInput {
  readonly updatedAt: string;
}

/** `/legal/<slug>` carries the slug, so it stays within this alphabet (v3 `[slug]/+page.server.ts`). */
export const LEGAL_SLUG = /^[a-z0-9-]{1,100}$/;
const SLUG_RULE = 'A legal page slug is 1 to 100 of a-z, 0-9 and "-".';

export interface InstanceStore {
  settings(): InstanceSettings;
  saveSettings(next: InstanceSettings): void;
  /** Every page, ordered by sort order, then slug. */
  pages(): readonly LegalPage[];
  page(slug: string): LegalPage | undefined;
  /** The pages shown in the consent modal's footer. */
  footerPages(): readonly LegalPage[];
  /** Creates or replaces a page. Throws for a slug outside `LEGAL_SLUG`. */
  savePage(page: LegalPageInput): LegalPage;
  removePage(slug: string): boolean;
  /** Creates a page; `undefined` when the slug is taken (nothing is written, no silent overwrite). */
  createPage(page: LegalPageInput): LegalPage | undefined;
  /**
   * Moves the page `from` to `page.slug` and sets its values, in one statement: `missing` when `from` does not exist,
   * `taken` when `page.slug` is another page. A rename to the same slug is a plain save.
   */
  renamePage(from: string, page: LegalPageInput): RenameResult;
}
export type RenameResult =
  | { readonly status: 'renamed'; readonly page: LegalPage }
  | { readonly status: 'missing' }
  | { readonly status: 'taken' };

interface PageRow {
  slug: string;
  title: string;
  body: string;
  sort_order: number;
  show_in_consent_footer: number;
  updated_at: string;
}
interface SettingsRow {
  require_consent: number;
  consent_title: string;
  consent_body: string;
  accept_label: string;
  reject_label: string;
}
const toPage = (r: PageRow): LegalPage => ({
  slug: r.slug,
  title: r.title,
  body: r.body,
  sortOrder: r.sort_order,
  showInConsentFooter: r.show_in_consent_footer === 1,
  updatedAt: r.updated_at,
});

export function createInstanceStore(control: Db, clock: Clock): InstanceStore {
  const columns = 'slug, title, body, sort_order, show_in_consent_footer, updated_at';
  const list = (where: string): readonly LegalPage[] =>
    control
      .prepare<PageRow>(`SELECT ${columns} FROM legal_pages ${where} ORDER BY sort_order, slug`)
      .all()
      .map(toPage);
  const readPage = control.prepare<PageRow>(`SELECT ${columns} FROM legal_pages WHERE slug = ?`);
  const writePage = control.prepare(
    `INSERT INTO legal_pages (${columns}) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET title = excluded.title, body = excluded.body, sort_order = excluded.sort_order,
       show_in_consent_footer = excluded.show_in_consent_footer, updated_at = excluded.updated_at`,
  );
  const insertPage = control.prepare(
    `INSERT INTO legal_pages (${columns}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (slug) DO NOTHING`,
  );
  // One statement: the guard and the move cannot be split by another writer.
  const movePage = control.prepare(
    `UPDATE legal_pages SET slug = ?, title = ?, body = ?, sort_order = ?, show_in_consent_footer = ?, updated_at = ?
     WHERE slug = ? AND (? = ? OR NOT EXISTS (SELECT 1 FROM legal_pages WHERE slug = ?))`,
  );
  const page = (slug: string): LegalPage | undefined => {
    const row = readPage.get(slug);
    return row === undefined ? undefined : toPage(row);
  };
  return {
    settings: () => {
      const r = control.prepare<SettingsRow>('SELECT * FROM instance_settings WHERE id = 1').get();
      if (r === undefined) throw new Error('instance_settings row is missing');
      return {
        requireConsent: r.require_consent === 1,
        consentTitle: r.consent_title,
        consentBody: r.consent_body,
        acceptLabel: r.accept_label,
        rejectLabel: r.reject_label,
      };
    },
    saveSettings: (s) => {
      control
        .prepare(
          `UPDATE instance_settings SET require_consent = ?, consent_title = ?, consent_body = ?, accept_label = ?,
             reject_label = ? WHERE id = 1`,
        )
        .run(s.requireConsent ? 1 : 0, s.consentTitle, s.consentBody, s.acceptLabel, s.rejectLabel);
    },
    pages: () => list(''),
    page,
    footerPages: () => list('WHERE show_in_consent_footer = 1'),
    savePage: (p) => {
      if (!LEGAL_SLUG.test(p.slug)) throw new Error(SLUG_RULE);
      writePage.run(p.slug, p.title, p.body, p.sortOrder, p.showInConsentFooter ? 1 : 0, clock.now());
      return page(p.slug) as LegalPage;
    },
    createPage: (p) => {
      if (!LEGAL_SLUG.test(p.slug)) throw new Error(SLUG_RULE);
      const r = insertPage.run(
        p.slug,
        p.title,
        p.body,
        p.sortOrder,
        p.showInConsentFooter ? 1 : 0,
        clock.now(),
      );
      return r.changes > 0 ? page(p.slug) : undefined;
    },
    renamePage: (from, p) => {
      if (!LEGAL_SLUG.test(p.slug)) throw new Error(SLUG_RULE);
      const r = movePage.run(
        p.slug,
        p.title,
        p.body,
        p.sortOrder,
        p.showInConsentFooter ? 1 : 0,
        clock.now(),
        from,
        p.slug,
        from,
        p.slug,
      );
      if (r.changes > 0) return { status: 'renamed', page: page(p.slug) as LegalPage };
      return { status: page(from) === undefined ? 'missing' : 'taken' };
    },
    removePage: (slug) => control.prepare('DELETE FROM legal_pages WHERE slug = ?').run(slug).changes > 0,
  };
}
