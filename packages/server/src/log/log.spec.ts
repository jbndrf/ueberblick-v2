import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_LOG_RETENTION_DAYS,
  FORBIDDEN_LOG_FIELDS,
  LOG_EVENTS,
  LOG_FIELD_KINDS,
  createLogger,
  logRetentionDays,
  truncateIp,
} from './index';

const make = (minLevel?: 'debug' | 'info' | 'warn' | 'error') => {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({ sink: (l) => lines.push(l), now: () => 1000, ...(minLevel ? { minLevel } : {}) }),
  };
};

describe('logger (WP-537)', () => {
  it('writes declared fields as one JSON line', () => {
    const { lines, logger } = make();
    logger.log('run.refused', { runId: 'r1', actor: 'a1', code: 'perm.denied', ms: 3 });
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      t: 1000,
      level: 'info',
      event: 'run.refused',
      runId: 'r1',
      actor: 'a1',
      code: 'perm.denied',
      ms: 3,
    });
  });

  it('rejects undeclared fields, values and input at type level', () => {
    const { logger } = make();
    // @ts-expect-error `input` is not a declared field of any event
    logger.log('run.refused', { runId: 'r1', actor: 'a1', code: 'x', ms: 1, input: { name: 'Eva' } });
    // @ts-expect-error `value` is not declared
    logger.log('run.committed', { runId: 'r', actor: 'a', observations: 1, ms: 1, value: 'secret' });
    // @ts-expect-error unknown event
    logger.log('run.unknown', {});
    // @ts-expect-error a count is a number, never an object
    logger.log('run.committed', { runId: 'r', actor: 'a', observations: { v: 1 }, ms: 1 });
    expect(true).toBe(true);
  });

  it('drops undeclared fields at runtime as well', () => {
    const { lines, logger } = make();
    const sneaky = { runId: 'r', actor: 'a', code: 'c', ms: 1, input: 'Eva Muster' };
    logger.log('run.refused', sneaky);
    expect(lines[0]).not.toContain('Eva');
  });

  it('no event declares a forbidden field name; every kind is registered', () => {
    for (const e of LOG_EVENTS) {
      for (const [name, kind] of Object.entries(e.fields)) {
        expect(FORBIDDEN_LOG_FIELDS as readonly string[]).not.toContain(name);
        expect(LOG_FIELD_KINDS.has(kind)).toBe(true);
      }
    }
  });

  it('truncates ip fields when logging', () => {
    const { lines, logger } = make();
    logger.log('auth.failed', { code: 'bad_token', ip: '203.0.113.77', actor: 'a1' });
    expect(lines[0]).toContain('203.0.113.0/24');
    expect(lines[0]).not.toContain('203.0.113.77'); // the full address, not a digit run a timing could hold
    expect((JSON.parse(lines[0] as string) as { ip: string }).ip).toBe('203.0.113.0/24');
  });

  it('honours the minimum level', () => {
    const { lines, logger } = make('warn');
    logger.log('run.committed', { runId: 'r', actor: 'a', observations: 1, ms: 1 });
    logger.log('http.error', { requestId: 'q', route: 'sync', code: 'e', ip: '1.2.3.4', ms: 1 });
    expect(lines).toHaveLength(1);
  });
});

describe('ip truncation', () => {
  it('IPv4 to /24', () => expect(truncateIp('192.168.5.200')).toBe('192.168.5.0/24'));
  it('IPv6 to /48', () => {
    expect(truncateIp('2001:db8:abcd:1234:5678::1')).toBe('2001:db8:abcd::/48');
    expect(truncateIp('2001:0db8:0:0:0:0:0:1')).toBe('2001:db8:0::/48');
    expect(truncateIp('::1')).toBe('0:0:0::/48');
  });
  it('maps IPv4-in-IPv6 and rejects junk', () => {
    expect(truncateIp('::ffff:10.1.2.3')).toBe('10.1.2.0/24');
    expect(truncateIp('nope')).toBe('invalid');
    expect(truncateIp('300.1.1.1')).toBe('invalid');
  });
  it('property: the host part never survives', () => {
    fc.assert(
      fc.property(fc.ipV4(), (ip) => {
        const out = truncateIp(ip);
        expect(out.endsWith('.0/24')).toBe(true);
        expect(out.split('.').slice(0, 3)).toEqual(ip.split('.').slice(0, 3));
      }),
    );
    fc.assert(
      fc.property(fc.ipV6(), (ip) => {
        const out = truncateIp(ip);
        expect(out === 'invalid' || out.endsWith('::/48')).toBe(true);
      }),
    );
  });
});

describe('retention', () => {
  it('defaults to 30 days and is configurable', () => {
    expect(DEFAULT_LOG_RETENTION_DAYS).toBe(30);
    expect(logRetentionDays({})).toBe(30);
    expect(logRetentionDays({ LOG_RETENTION_DAYS: '7' })).toBe(7);
  });
  it.each(['-1', 'x', '0', '1.5', ''])('throws on an invalid value %j', (v) => {
    expect(() => logRetentionDays({ LOG_RETENTION_DAYS: v })).toThrow(/LOG_RETENTION_DAYS/);
  });
});
