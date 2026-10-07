/**
 * The Infoseiten the section lists (v3 `InfoPagesSection.svelte`), as plain rows computed from a project file. The
 * variables a page may hold are the ones the participant side replaces (`participant/info-pages/render.ts`); the HTML is
 * shown to participants through the one shared sanitiser, so the list's snippet uses it too (R1).
 */
import { localize, orderedInfoPages, type TemplateFile } from '@ueberblick/core';
import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';
import { sanitizeHtml } from '../../participant/login/sanitize-html';

export interface InfoPageRow {
  /** The config key (`info_pages.<key>`); never renamed. */
  readonly key: string;
  readonly title: string;
  /** The authored HTML (not sanitised: the participant side does that on display). */
  readonly content: string;
  readonly sortOrder: number;
}

/** What a page edit sends. A missing `key` is a new page. */
export interface InfoPageValues {
  readonly key?: string;
  readonly title: string;
  readonly content: string;
  readonly sortOrder: number;
}

/** v3's four per-participant variables, in v3's order, with the line that explains each. */
export const INFO_VARIABLES: readonly { readonly marker: string; readonly hint: AdminKey }[] = [
  { marker: '$token', hint: 'info_var_token' },
  { marker: '$loginlink', hint: 'info_var_login_link' },
  { marker: '$qrtoken', hint: 'info_var_qr_token' },
  { marker: '$qrloginlink', hint: 'info_var_qr_login_link' },
];

/** The pages in sort order; equal or absent orders keep the authored order (as the bootstrap lists them). */
export function infoPageRows(file: TemplateFile, locale: string): InfoPageRow[] {
  return orderedInfoPages(file.info_pages).map(({ key, page, sortOrder }) => ({
    key,
    title: localize(page.title, [locale]) || key,
    content: localize(page.content, [locale]),
    sortOrder,
  }));
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&quot;': '"',
};

/** The text of a page without markup, for the list's two-line snippet (v3 `stripHtml`). */
export function plainText(html: string): string {
  return sanitizeHtml(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|nbsp|quot);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Why a form is refused before it is sent (v3: the `required` attributes of title and content, `min=0` of the order). */
export function infoPageProblem(v: InfoPageValues): 'title' | 'content' | 'sort' | null {
  if (v.title.trim() === '') return 'title';
  if (v.content.trim() === '') return 'content';
  if (!Number.isFinite(v.sortOrder) || v.sortOrder < 0) return 'sort';
  return null;
}
