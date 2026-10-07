import type { Locale } from '$lib/participant/messages';

/** German unless English is asked for first: the same rule as `hooks.server.ts` uses for the page language. */
export const localeOfRequest = (request: Request): Locale =>
  /^\s*en\b/i.test(request.headers.get('accept-language') ?? '') ? 'en' : 'de';
