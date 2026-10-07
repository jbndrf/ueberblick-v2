import { localize as coreLocalize } from '@ueberblick/core/locale';
import type { LocalizedString } from '@ueberblick/core/model';

/** `localize()` of core for one UI locale (decision 0019). */
export function localize(text: LocalizedString, locale: string): string {
  return coreLocalize(text, [locale]);
}
