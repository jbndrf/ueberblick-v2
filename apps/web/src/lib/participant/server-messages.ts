/**
 * Participant messages for server-side code (WP-1021). `./messages` pulls the whole Paraglide barrel (about 1800
 * per-message modules, ~5.5 s of transform at first import); the join handlers need three strings, so they import
 * those per-message modules directly. Same `message(locale, key)` result as `./messages` for these keys
 * (`server-messages.spec.ts` proves it). A server file that needs another key adds its module here.
 */
import { participant_join_failed } from './paraglide/messages/participant_join_failed.js';
import { participant_join_not_found } from './paraglide/messages/participant_join_not_found.js';
import { participant_join_throttled } from './paraglide/messages/participant_join_throttled.js';
import type { Locale } from './messages';

const byKey = {
  join_failed: participant_join_failed,
  join_not_found: participant_join_not_found,
  join_throttled: participant_join_throttled,
};

export type ServerMessageKey = keyof typeof byKey;

export const message = (locale: Locale, key: ServerMessageKey): string => byKey[key]({}, { locale });
