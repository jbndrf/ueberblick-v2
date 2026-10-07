// WP-163: http.error and auth.failed, with declared fields only.
import { describe, expect, it } from 'vitest';
import { expectDeclaredFieldsOnly, logSpy } from '../../store/run/log.testkit';
import { createLogger } from '../../log';
import { logAuthFailure, logHttpAccess, logHttpError } from './observe';

describe('http.error', () => {
  it('one line with the route pattern, a fixed code, the truncated ip and the duration', () => {
    const spy = logSpy();
    logHttpError(spy.log, { status: 500, route: '/api/p/[project]/sync', ip: '203.0.113.77', ms: 12.5 });
    const lines = spy.only('http.error');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      route: '/api/p/[project]/sync',
      code: 'unhandled',
      ip: '203.0.113.0/24',
      ms: 12.5,
    });
    expect(typeof lines[0]?.['requestId']).toBe('string');
    expectDeclaredFieldsOnly(spy.lines());
    expect(JSON.stringify(spy.lines())).not.toContain('203.0.113.77');
  });

  it('an unmatched route is named unmatched', () => {
    const spy = logSpy();
    logHttpError(spy.log, { status: 500, route: null, ip: '2001:db8:abcd:1::1', ms: 1 });
    expect(spy.only('http.error')[0]).toMatchObject({ route: 'unmatched', ip: '2001:db8:abcd::/48' });
  });
});

const answer = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('http.error status gate', () => {
  it('a 404 (a probe of an unknown route) logs nothing; a 500 logs one line', () => {
    const spy = logSpy();
    logHttpError(spy.log, { status: 404, route: null, ip: '203.0.113.7', ms: 1 });
    logHttpError(spy.log, { status: 499, route: null, ip: '203.0.113.7', ms: 1 });
    expect(spy.lines()).toEqual([]);
    logHttpError(spy.log, { status: 500, route: '/api/x', ip: '203.0.113.7', ms: 1 });
    expect(spy.only('http.error')).toHaveLength(1);
  });
});

describe('auth.failed', () => {
  it('a 429 from the throttle logs code throttled', async () => {
    const spy = logSpy();
    await logAuthFailure(
      spy.log,
      answer(429, { error: 'Too many attempts. Try again later.' }),
      '198.51.100.9',
    );
    expect(spy.only('auth.failed')).toHaveLength(1);
    expect(spy.only('auth.failed')[0]).toMatchObject({ code: 'throttled', ip: '198.51.100.0/24' });
    expectDeclaredFieldsOnly(spy.lines());
  });

  it('a 401 with a registered code logs one line with code, truncated ip and anonymous actor', async () => {
    const spy = logSpy();
    const res = answer(401, { code: 'invalid_login' });
    await logAuthFailure(spy.log, res, '198.51.100.9');
    const lines = spy.only('auth.failed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'warn',
      code: 'invalid_login',
      ip: '198.51.100.0/24',
      actor: 'anonymous',
    });
    expectDeclaredFieldsOnly(spy.lines());
    expect(await res.json()).toEqual({ code: 'invalid_login' }); // the caller's response is still readable
  });

  it('a success, an unknown code, a foreign body or no JSON log nothing', async () => {
    const spy = logSpy();
    await logAuthFailure(spy.log, answer(200, { ok: true }), '198.51.100.9');
    await logAuthFailure(spy.log, answer(401, { code: 'not_registered' }), '198.51.100.9');
    await logAuthFailure(spy.log, answer(401, { error: 'x' }), '198.51.100.9');
    await logAuthFailure(spy.log, new Response('nope', { status: 401 }), '198.51.100.9');
    expect(spy.lines()).toEqual([]);
  });
});

describe('request logs never carry a query string or fragment (WP-942)', () => {
  it('a route that arrives with a query or fragment (a token in the URL) is cut at its first ? or #', () => {
    const spy = logSpy();
    logHttpError(spy.log, {
      status: 500,
      route: '/api/auth/exchange?token=SECRET123#frag',
      ip: '203.0.113.77',
      ms: 1,
    });
    logHttpError(spy.log, { status: 500, route: '/b/[project]#top', ip: '203.0.113.77', ms: 1 });
    const lines = spy.only('http.error');
    expect(lines[0]).toMatchObject({ route: '/api/auth/exchange', ip: '203.0.113.0/24' });
    expect(lines[1]).toMatchObject({ route: '/b/[project]' });
    expect(JSON.stringify(lines)).not.toMatch(/SECRET123|token=|frag/);
  });

  it('client addresses are anonymized (IPv4 to /24, IPv6 to /48) in every line', async () => {
    const spy = logSpy();
    logHttpError(spy.log, { status: 500, route: null, ip: '198.51.100.201', ms: 1 });
    await logAuthFailure(
      spy.log,
      new Response(JSON.stringify({ code: 'invalid_login' }), { status: 401 }),
      '2001:db8:abcd:1::7',
    );
    expect(spy.only('http.error')[0]).toMatchObject({ ip: '198.51.100.0/24' });
    expect(spy.only('auth.failed')[0]).toMatchObject({ ip: '2001:db8:abcd::/48' });
  });
});

describe('http.access (WP-1043)', () => {
  const req = { method: 'GET', route: '/api/p/[project]/sync', status: 200, ip: '203.0.113.77', ms: 3.5 };

  it('a 200 writes one info line: method, route pattern, status, truncated ip, duration', () => {
    const spy = logSpy();
    logHttpAccess(spy.log, req);
    expect(spy.only('http.access')).toEqual([
      {
        t: 1,
        level: 'info',
        event: 'http.access',
        method: 'GET',
        route: '/api/p/[project]/sync',
        status: 200,
        ip: '203.0.113.0/24',
        ms: 3.5,
      },
    ]);
    expectDeclaredFieldsOnly(spy.lines());
    expect(JSON.stringify(spy.lines())).not.toContain('203.0.113.77');
  });

  it('early answers and 5xx are logged too; no route is named unmatched', () => {
    const spy = logSpy();
    logHttpAccess(spy.log, { ...req, method: 'POST', route: null, status: 413 });
    logHttpAccess(spy.log, { ...req, status: 308 });
    logHttpAccess(spy.log, { ...req, status: 500 });
    expect(spy.only('http.access').map((l) => l['status'])).toEqual([413, 308, 500]);
    expect(spy.only('http.access')[0]).toMatchObject({ route: 'unmatched', method: 'POST' });
    expectDeclaredFieldsOnly(spy.lines());
  });

  it('a query string or fragment in the route never reaches the line (login tokens live in URLs)', () => {
    const spy = logSpy();
    logHttpAccess(spy.log, { ...req, route: '/api/auth/exchange?token=SECRET#frag' });
    const text = JSON.stringify(spy.lines());
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('token');
    expect(spy.only('http.access')[0]).toMatchObject({ route: '/api/auth/exchange' });
  });

  it('a throwing sink does not throw into the request', () => {
    const log = createLogger({
      sink: () => {
        throw new Error('disk full');
      },
      now: () => 1,
    });
    expect(() => logHttpAccess(log, req)).not.toThrow();
  });
});
