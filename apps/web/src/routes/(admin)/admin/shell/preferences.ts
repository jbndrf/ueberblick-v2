import { localeCookie, type Locale } from './locale';

/** Remembers the language the admin chose (the layout reads it on the next load). Browser only. */
export function storeLocale(locale: Locale): void {
  document.cookie = localeCookie(locale);
}
