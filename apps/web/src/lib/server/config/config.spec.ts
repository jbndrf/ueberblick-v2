import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ConfigError, DECLARED, DOCUMENTED, loadConfig } from './index';

const ok = { PUBLIC_URL: 'https://ueberblick.example.org' };
const problemsOf = (env: Record<string, string>): string => {
  try {
    loadConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as Error).message;
  }
  throw new Error('expected a ConfigError');
};

describe('loadConfig', () => {
  it('parses a minimal environment with the defaults of .env.example', () => {
    expect(loadConfig(ok)).toMatchObject({
      publicUrl: 'https://ueberblick.example.org',
      httpsMode: 'proxy',
      httpsPort: 8443,
      httpPort: 8080,
      appPort: 3000,
      admin: null,
      adminTotp: false,
      uploadLimit: { text: '50M', bytes: 50 * 1024 * 1024 },
      sessionDays: { participant: 90, adminRemember: 30 },
      backupDir: null,
      timersIntervalMs: 30_000,
      dataDir: './data',
      logLevel: 'info',
      secureCookies: true,
    });
  });

  it('parses every variable', () => {
    const c = loadConfig({
      PUBLIC_URL: 'http://192.168.1.90:8443/',
      HTTPS_MODE: 'direct',
      LOCAL_HOSTS: '192.168.1.90, ueberblick.local',
      HTTPS_PORT: '9443',
      HTTP_PORT: '9080',
      TRUSTED_PROXIES: '10.0.0.1, 172.16.0.0/12, ::1',
      APP_PORT: '8080',
      ADMIN_EMAIL: 'admin@example.org',
      ADMIN_PASSWORD: 'a long enough password',
      ADMIN_TOTP: 'on',
      UPLOAD_LIMIT: '1g',
      SESSION_DAYS_PARTICIPANT: '7',
      SESSION_DAYS_ADMIN_REMEMBER: '14',
      BACKUP_DIR: '/mnt/nas',
      TIMERS_INTERVAL_S: '0',
      DATA_DIR: '/data',
      UEBERBLICK_LOG_LEVEL: 'warn',
      UEBERBLICK_MCP_SECRET: 's',
      UEBERBLICK_INSECURE_COOKIES: '1',
    });
    expect(c).toMatchObject({
      publicUrl: 'http://192.168.1.90:8443',
      httpsMode: 'direct',
      localHosts: ['192.168.1.90', 'ueberblick.local'],
      httpsPort: 9443,
      httpPort: 9080,
      trustedProxies: ['10.0.0.1', '172.16.0.0/12', '::1'],
      appPort: 8080,
      admin: { email: 'admin@example.org', password: 'a long enough password' },
      adminTotp: true,
      uploadLimit: { text: '1G', bytes: 1024 ** 3 },
      sessionDays: { participant: 7, adminRemember: 14 },
      backupDir: '/mnt/nas',
      timersIntervalMs: 0,
      dataDir: '/data',
      logLevel: 'warn',
      mcpSecret: 's',
      secureCookies: false,
    });
  });

  it('cookies are Secure when the address is https or HTTPS_MODE=direct, unless the test-only switch is set', () => {
    expect(loadConfig({ PUBLIC_URL: 'https://x.example.org' }).secureCookies).toBe(true);
    expect(loadConfig({ PUBLIC_URL: 'http://x.example.org' }).secureCookies).toBe(false);
    expect(
      loadConfig({
        PUBLIC_URL: 'http://192.168.1.90:8443',
        HTTPS_MODE: 'direct',
        LOCAL_HOSTS: '192.168.1.90',
      }).secureCookies,
    ).toBe(true);
    expect(
      loadConfig({ PUBLIC_URL: 'https://x.example.org', UEBERBLICK_INSECURE_COOKIES: '1' }).secureCookies,
    ).toBe(false);
  });

  it('treats an empty value as unset (the lines of .env.example)', () => {
    const c = loadConfig({
      ...ok,
      LOCAL_HOSTS: '',
      HTTPS_PORT: '',
      ADMIN_EMAIL: '',
      ADMIN_PASSWORD: '',
      BACKUP_DIR: '',
    });
    expect(c).toMatchObject({ localHosts: [], httpsPort: 8443, admin: null, backupDir: null });
  });

  it('refuses a missing PUBLIC_URL, naming it', () => {
    expect(problemsOf({})).toMatch(/PUBLIC_URL is required/);
    expect(problemsOf({ PUBLIC_URL: '  ' })).toMatch(/PUBLIC_URL is required/);
  });

  it('refuses LOCAL_HOSTS-less direct mode, naming LOCAL_HOSTS', () => {
    expect(problemsOf({ ...ok, HTTPS_MODE: 'direct' })).toMatch(
      /LOCAL_HOSTS is required when HTTPS_MODE=direct/,
    );
  });

  it('HTTP_PORT: 0 turns the redirect off; in proxy mode it is ignored, not refused', () => {
    expect(loadConfig({ ...ok, HTTP_PORT: '0' }).httpPort).toBe(0);
    expect(loadConfig({ ...ok, HTTPS_MODE: 'proxy', HTTP_PORT: '8081' }).httpsMode).toBe('proxy');
  });

  it('refuses an admin e-mail without a password and the other way round', () => {
    expect(problemsOf({ ...ok, ADMIN_EMAIL: 'a@b.de' })).toMatch(/ADMIN_PASSWORD is missing/);
    expect(problemsOf({ ...ok, ADMIN_PASSWORD: 'x'.repeat(10) })).toMatch(/ADMIN_EMAIL is missing/);
  });

  const BAD: readonly (readonly [string, string])[] = [
    ['PUBLIC_URL', 'ueberblick.example.org'],
    ['PUBLIC_URL', 'https://example.org/app'],
    ['PUBLIC_URL', 'ftp://example.org'],
    ['HTTPS_MODE', 'foo'],
    ['HTTPS_MODE', 'PROXY'],
    ['LOCAL_HOSTS', 'not a host'],
    ['HTTPS_PORT', '0'],
    ['HTTPS_PORT', '70000'],
    ['HTTPS_PORT', 'abc'],
    ['HTTP_PORT', '70000'],
    ['HTTP_PORT', 'abc'],
    ['HTTP_PORT', '-1'],
    ['TRUSTED_PROXIES', 'nope'],
    ['TRUSTED_PROXIES', '10.0.0.0/40'],
    ['APP_PORT', '-1'],
    ['ADMIN_EMAIL', 'not-an-email'],
    ['ADMIN_PASSWORD', 'short'],
    ['ADMIN_TOTP', 'yes'],
    ['UPLOAD_LIMIT', 'lots'],
    ['UPLOAD_LIMIT', '0M'],
    ['SESSION_DAYS_PARTICIPANT', '0'],
    ['SESSION_DAYS_ADMIN_REMEMBER', '1.5'],
    ['TIMERS_INTERVAL_S', 'soon'],
    ['TIMERS_INTERVAL_S', '-3'],
    ['UEBERBLICK_LOG_LEVEL', 'loud'],
  ];
  it.each(BAD)('a bad %s (%s) stops the start with a message naming the variable', (name, value) => {
    const env: Record<string, string> = { ...ok, [name]: value };
    if (name === 'ADMIN_EMAIL') env['ADMIN_PASSWORD'] = 'x'.repeat(10);
    if (name === 'ADMIN_PASSWORD') env['ADMIN_EMAIL'] = 'a@b.de';
    expect(problemsOf(env)).toContain(name);
  });

  it('lists every problem at once', () => {
    const m = problemsOf({ HTTPS_MODE: 'foo', APP_PORT: 'x' });
    for (const n of ['PUBLIC_URL', 'HTTPS_MODE', 'APP_PORT']) expect(m).toContain(n);
  });

  it('property: any whole number of seconds is accepted and scaled, any other text is refused', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 86_400 }), (n) => {
        expect(loadConfig({ ...ok, TIMERS_INTERVAL_S: String(n) }).timersIntervalMs).toBe(n * 1000);
      }),
    );
    fc.assert(
      fc.property(
        fc.string().filter((s) => s.trim() !== '' && !/^\s*\d+\s*$/.test(s)),
        (s) => {
          expect(() => loadConfig({ ...ok, TIMERS_INTERVAL_S: s })).toThrow(/TIMERS_INTERVAL_S/);
        },
      ),
    );
  });
});

describe('.env.example', () => {
  const text = readFileSync(
    fileURLToPath(new URL('../../../../../../.env.example', import.meta.url)),
    'utf8',
  );
  const names = text
    .split('\n')
    .map((l) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((n): n is string => n !== undefined);

  it('lists exactly the documented variables of the config module, each once', () => {
    expect([...names].sort()).toEqual([...DOCUMENTED].sort());
  });

  it('never lists an internal variable, and every documented one is declared', () => {
    for (const n of names) expect(DECLARED).toContain(n);
    expect(names).not.toContain('UEBERBLICK_INSECURE_COOKIES');
  });

  it('parses as is once PUBLIC_URL and the admin are filled', () => {
    const env: Record<string, string> = {};
    for (const l of text.split('\n')) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);
      if (m?.[1] !== undefined) env[m[1]] = m[2] ?? '';
    }
    env['ADMIN_EMAIL'] = 'admin@example.org';
    env['ADMIN_PASSWORD'] = 'a long enough password';
    expect(() => loadConfig(env)).not.toThrow();
  });
});
