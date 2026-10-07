/**
 * Language tag to `Locale`. Kept apart from `./messages` on purpose: that module pulls in the whole Paraglide barrel
 * (about 1800 modules), which server-side code and specs should not pay for just to read a tag (WP-1018).
 */
import type { Locale } from './messages';

export const localeOf = (tag: string): Locale => (tag.toLowerCase().startsWith('en') ? 'en' : 'de');
