import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// hooks.server.ts imports through the `$lib` alias, which the unit-test config does not resolve, so the wiring is
// asserted on the source. The events themselves are tested in packages/server (http/shared/observe.spec.ts).
const src = readFileSync(resolve(import.meta.dirname, 'hooks.server.ts'), 'utf8');

describe('hooks.server.ts emits the declared http and auth events (WP-163)', () => {
  it('exports handleError, which logs http.error through the runtime logger', () => {
    expect(src).toMatch(/export const handleError: HandleServerError/);
    expect(src).toMatch(/logHttpError\(runtime\(\)\.log,/);
  });

  it('logs auth.failed for the two sign-in routes only, through the runtime logger', () => {
    expect(src).toMatch(/'\/api\/auth\/exchange', '\/api\/auth\/login'/);
    expect(src).toMatch(/logAuthFailure\(rt\.log, response,/);
  });

  it('passes the status to logHttpError, which ignores anything below 500', () => {
    expect(src).toMatch(/\(\{ event, status \}\) =>/);
    expect(src).toMatch(/logHttpError\(runtime\(\)\.log, \{\s+status,/);
  });

  it('takes no logger of its own and never writes to the console', () => {
    expect(src).not.toMatch(/createLogger|console\./);
  });
});

describe('hooks.server.ts asks the entry guard first (WP-941, WP-942)', () => {
  it('feeds the socket address, request and path to entryGuard and uses its client address and early answer', () => {
    expect(src).toMatch(/entryGuard\(\{\s+config: config\(\),\s+uploadLimitBytes:/);
    expect(src).toMatch(/peer: addressOf\(event\)/);
    expect(src).toMatch(/event\.getClientAddress = \(\) => gate\.clientAddress/);
    expect(src).toMatch(/if \(early\) return early/);
  });

  it('sets HSTS from what the gate saw, not from the request url', () => {
    expect(src).toMatch(/withSecurityHeaders\(response, gate\.https, /);
    expect(src).not.toMatch(/url\.protocol/);
  });

  it('does not read X-Forwarded-* itself', () => {
    expect(src).not.toMatch(/x-forwarded/i);
  });
});

describe('hooks.server.ts writes one http.access line per request (WP-1043)', () => {
  it('wraps the whole handle, so early answers and the 303 are logged, with the route pattern and no url', () => {
    expect(src).toMatch(/export const handle: Handle = async \(input\) =>/);
    expect(src).toMatch(
      /logHttpAccess\(runtime\(\)\.log, \{\s+method: event\.request\.method,\s+route: event\.route\.id,/,
    );
    expect(src).not.toMatch(/logHttpAccess\([^)]*(url|pathname|search)/);
  });
});

describe('hooks.server.ts redirects a signed-out /map by the participant session only (WP-731)', () => {
  it('feeds signedOutRedirect with the participant session from sessionsOf, not the admin one', () => {
    expect(src).toMatch(/signedIn:\s*participant !== null/);
  });
});
