/**
 * Login throttling port. The in-memory adapter is per process; a shared store (several processes) implements
 * the same port later. Keys are opaque strings built by the caller (IP plus account or credential).
 */
export type RateVerdict = { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number };

export interface RateLimiter {
  /** Is another attempt allowed for this key right now? Does not count anything. */
  check(key: string): RateVerdict;
  /** Records one failed attempt. */
  fail(key: string): void;
  /** A success clears the key. */
  reset(key: string): void;
}
