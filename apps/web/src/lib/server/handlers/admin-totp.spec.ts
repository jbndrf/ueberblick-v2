import { describe, expect, it, vi } from 'vitest';
import { createLogger, type Principal } from '@ueberblick/server';

const enrolTotp = vi.fn();
const verifyTotp = vi.fn(() => true);
const lines: string[] = [];
const log = createLogger({ sink: (l) => lines.push(l), now: () => 1 });
vi.mock('../runtime', () => ({ runtime: () => ({ log, auth: { enrolTotp, verifyTotp } }) }));
const { confirm, enrol } = await import('./admin-totp');

const call = (principal: Principal | null, body: unknown = { code: '123456' }) =>
  ({
    locals: { admin: principal },
    params: {},
    request: new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as Parameters<typeof enrol>[0];
const participant: Principal = { kind: 'participant', id: 'p', projectId: 'x', roles: [] };
const admin: Principal = { kind: 'admin', id: 'a', projectId: null, roles: [] };

describe('TOTP confirm logs auth.failed (WP-163)', () => {
  it('a rejected code logs totp_rejected with the admin id and the truncated ip, never the code', async () => {
    lines.length = 0;
    verifyTotp.mockReturnValueOnce(false);
    expect((await confirm(call(admin, { code: '987654' }))).status).toBe(400);
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({
      event: 'auth.failed',
      code: 'totp_rejected',
      actor: 'a',
      ip: '127.0.0.0/24',
    });
    expect(Object.keys(line).sort()).toEqual(['actor', 'code', 'event', 'ip', 'level', 't']);
    expect(lines[0]).not.toContain('987654');
  });

  it('an accepted code logs nothing', async () => {
    lines.length = 0;
    // its own admin: the throttle is process-wide, and `--repeats` runs the rejected-code test 5 times first,
    // which fills the strict per-account window of 'a' (429 instead of 200, reported by lead-b 2026-10-03)
    expect((await confirm(call({ ...admin, id: 'a-accepted' }))).status).toBe(200);
    expect(lines).toEqual([]);
  });
});

describe('TOTP handlers', () => {
  it('refuse a participant with 403 and an anonymous caller with 401', async () => {
    expect(enrol(call(participant)).status).toBe(403);
    expect((await confirm(call(participant))).status).toBe(403);
    expect(enrol(call(null)).status).toBe(401);
    expect((await confirm(call(null))).status).toBe(401);
  });
  it('maps only the already-enrolled error to 409 and rethrows anything else', () => {
    enrolTotp.mockImplementationOnce(() => {
      throw new Error('TOTP already enrolled; use resetTotp');
    });
    expect(enrol(call(admin)).status).toBe(409);
    enrolTotp.mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    expect(() => enrol(call(admin))).toThrow('database is locked');
  });
});
