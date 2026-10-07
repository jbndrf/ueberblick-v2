import { getLocale, overwriteGetLocale } from './paraglide/runtime.js';

/** The ui package's own languages (the compiled catalogue's locales). */
export type UiLocale = 'de' | 'en';

/** The runtime's own resolution (cookie `PARAGLIDE_LOCALE`, then the base locale), kept to switch back to. */
const resolveByRuntime = getLocale;

/**
 * Tells the kit which language its strings use. An app that keeps its own language setting (the admin: the `ub_locale`
 * cookie) calls this with it instead of importing the generated runtime. Call it again on every language switch and
 * remount what is on screen: message calls are not reactive. `undefined` goes back to the runtime's own resolution.
 *
 * The language is module-wide, not per request: during server rendering set it in the same synchronous pass that
 * renders the kit components (Svelte's server render is synchronous), never across an `await`.
 */
export function setUiLocale(locale: UiLocale | undefined): void {
  overwriteGetLocale(locale === undefined ? resolveByRuntime : () => locale);
}
