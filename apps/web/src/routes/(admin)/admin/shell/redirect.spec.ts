import { describe, expect, it } from 'vitest';
import { ADMIN_HOME, loginUrl, redirectTarget } from './redirect';

describe('redirectTarget: only a same-origin path is followed after sign-in', () => {
  it.each(['/admin/projects', '/admin/projects/abc/participants?x=1', '/builder/musterstadt'])(
    'keeps %s',
    (raw) => expect(redirectTarget(raw)).toBe(raw),
  );
  it.each([
    null,
    undefined,
    '',
    'https://evil.example/admin',
    '//evil.example',
    '/\\evil',
    'admin/projects',
    '/a\nb',
  ])('sends %j to the admin home', (raw) => expect(redirectTarget(raw)).toBe(ADMIN_HOME));
});

describe('loginUrl', () => {
  it('keeps where the admin was going, path and query', () => {
    const url = new URL(loginUrl('/admin/projects/p1/roles?tab=2'), 'http://x');
    expect(url.pathname).toBe('/admin/login');
    expect(url.searchParams.get('redirectTo')).toBe('/admin/projects/p1/roles?tab=2');
  });
});
