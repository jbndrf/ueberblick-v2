/** The pages Profil lists, taken from the cached bootstrap identity in the person's language (no fetch, works offline). */
import { resolveLabel } from '@ueberblick/ui';
import type { BootstrapIdentity } from '../http';
import type { Locale } from '../messages';

export interface PageEntry {
  readonly id: string;
  readonly title: string;
  /** Authored HTML, not yet sanitised. */
  readonly content: string;
}

/** Info pages in sort order. */
export function infoEntries(identity: Pick<BootstrapIdentity, 'infoPages'>, locale: Locale): PageEntry[] {
  return identity.infoPages.map((p) => ({
    id: p.key,
    title: resolveLabel(p.title, locale, p.key),
    content: resolveLabel(p.content, locale, ''),
  }));
}

/** The instance's legal pages in the operator's order. */
export function legalEntries(identity: Pick<BootstrapIdentity, 'legalPages'>): PageEntry[] {
  return identity.legalPages.map((p) => ({ id: p.slug, title: p.title, content: p.body }));
}
