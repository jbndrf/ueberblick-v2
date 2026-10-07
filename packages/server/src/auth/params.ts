/** Every tunable of the auth module lives here (one place). */

/** scrypt (memory-hard KDF from node:crypto). Memory = 128 * n * r bytes = 32 MiB. */
export const PASSWORD_PARAMS = { n: 32768, r: 8, p: 1, keyLen: 32, saltLen: 16 } as const;
/** Node refuses scrypt above `maxmem`; leave headroom over 128 * n * r. */
export const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const TOTP_PARAMS = {
  digits: 6,
  periodSeconds: 30,
  windowSteps: 1,
  secretBytes: 20,
  issuer: 'Ueberblick',
} as const;

/** Session lifetimes in milliseconds. Field devices stay signed in long; the admin UI does not. */
export const SESSION_TTL_MS = { participant: 90 * 24 * 3600_000, admin: 12 * 3600_000 } as const;

export const RANDOM_BYTES = { token: 32, sessionId: 32, accountId: 16 } as const;

/** A participant session slides: `authenticate` moves its expiry forward at most once per interval (v3 refreshed on every request). */
export const SESSION_RENEW_INTERVAL_MS = 24 * 3600_000;

/**
 * Admin-chosen tokens. v3 had no rule (its login only required a non-empty token, `participantLoginSchema`);
 * v4 adds one: 8 to 128 characters of letters, numbers, `-` and `_` (URL- and QR-safe, nothing to mistype).
 */
export const TOKEN_RULES = { minLength: 8, maxLength: 128, pattern: /^[A-Za-z0-9_-]+$/ } as const;

/**
 * Generated tokens: 20 symbols from 32 unambiguous ones (A-Z without I and O, 2-9), shown as XXXX-XXXX-XXXX-XXXX-XXXX.
 * 32 symbols are exactly 5 bits each (no modulo bias), so 100 bits of entropy. With the login rate limit
 * (a handful of attempts per window per client) guessing one token is infeasible.
 */
export const GENERATED_TOKEN = { alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', chars: 20, group: 4 } as const;

/**
 * One cookie per session kind (WP-705), so an admin and a participant session live side by side in one browser. The
 * keys are the principal kinds; a new kind (a role app, an assistant) is one more entry. Names live only here.
 */
export const SESSION_COOKIES = { participant: 'ub_session_participant', admin: 'ub_session_admin' } as const;
export type SessionKind = keyof typeof SESSION_COOKIES;
export const MIN_PASSWORD_LENGTH = 10;
