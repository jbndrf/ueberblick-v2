/**
 * Login throttling (WP-114). Two windows per scope: a strict one per (client address, account or credential)
 * and a wider one per client address. Failures count, a success clears only the strict key (so a valid login
 * of the attacker's own account cannot clear the counter of another). The store is the `RateLimiter` port;
 * only the in-memory adapter exists today.
 */
import { createHash } from 'node:crypto';
import { createMemoryRateLimiter, type RateLimiter } from '@ueberblick/server';
import { json, type Call } from './handlers/http';

const WINDOW_MS = 15 * 60_000;
const PER_SUBJECT = 5;
const PER_ADDRESS = 30;

/** One attempt at a throttled action. `refused` is the 429 answer when the caller must not try. */
export interface Attempt {
  readonly refused: Response | undefined;
  fail(): void;
  succeed(): void;
}

export interface Throttle {
  /** `scope` names the action (`login`, `exchange`, `totp`); `subject` is the account or credential. */
  attempt(scope: string, address: string, subject: string): Attempt;
}

const digest = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32);

export function createThrottle(now: () => Date): Throttle {
  const strict: RateLimiter = createMemoryRateLimiter({ now, maxFailures: PER_SUBJECT, windowMs: WINDOW_MS });
  const wide: RateLimiter = createMemoryRateLimiter({ now, maxFailures: PER_ADDRESS, windowMs: WINDOW_MS });
  return {
    attempt(scope, address, subject) {
      const strictKey = `${scope}|${address}|${digest(subject.trim().toLowerCase())}`;
      const wideKey = `${scope}|${address}`;
      const [a, b] = [strict.check(strictKey), wide.check(wideKey)];
      const wait = Math.max(a.ok ? 0 : a.retryAfterSeconds, b.ok ? 0 : b.retryAfterSeconds);
      const refused =
        a.ok && b.ok
          ? undefined
          : json({ error: 'Too many attempts. Try again later.' }, 429, { 'retry-after': String(wait) });
      return {
        refused,
        fail() {
          strict.fail(strictKey);
          wide.fail(wideKey);
        },
        succeed() {
          strict.reset(strictKey);
        },
      };
    },
  };
}

let shared: Throttle | undefined;
/** The process-wide throttle. */
export const throttle = (): Throttle => (shared ??= createThrottle(() => new Date()));

/** Client address: the socket peer, or behind a trusted proxy the real client (`tls/gate.ts`, set in `hooks.server.ts`). */
export const addressOf = (call: Pick<Call, 'getClientAddress'>): string => call.getClientAddress();
