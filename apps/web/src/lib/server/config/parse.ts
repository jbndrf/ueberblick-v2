import { isIP } from 'node:net';
import { LOG_LEVELS, type LogLevel } from '@ueberblick/server';
import { HTTPS_MODES, SWITCH_VALUES } from './vars';

export type HttpsMode = (typeof HTTPS_MODES)[number];

/** The parsed environment: every field is validated and typed. */
export interface Config {
  /** The address people open, as an origin (no path): used for links, QR codes and adapter-node's `ORIGIN`. */
  readonly publicUrl: string;
  readonly httpsMode: HttpsMode;
  readonly localHosts: readonly string[];
  readonly httpsPort: number;
  /** `direct` only: the plain-http port that redirects to https; 0 = off. Ignored in proxy mode (the proxy redirects). */
  readonly httpPort: number;
  readonly trustedProxies: readonly string[];
  readonly appPort: number;
  /** The first admin to create when none exists (WP-942); null when `ADMIN_EMAIL` and `ADMIN_PASSWORD` are unset. */
  readonly admin: { readonly email: string; readonly password: string } | null;
  readonly adminTotp: boolean;
  /** Largest upload, as written (`50M`), and in bytes. */
  readonly uploadLimit: { readonly text: string; readonly bytes: number };
  readonly sessionDays: { readonly participant: number; readonly adminRemember: number };
  /** A local folder for backups; null = off. */
  readonly backupDir: string | null;
  /** Beat of the timers loop in ms; 0 = off. */
  readonly timersIntervalMs: number;
  readonly dataDir: string;
  readonly logLevel: LogLevel;
  /** The MCP confirmation key, or null (a random one per process). */
  readonly mcpSecret: string | null;
  /** `Secure` cookies when people reach the app over https (an https `PUBLIC_URL`, or `HTTPS_MODE=direct`); the test-only switch turns them off. */
  readonly secureCookies: boolean;
  /** Build offline packs in the background (default on); `PACK_BUILD=0` turns it off (tests, e2e). */
  readonly packBuild: boolean;
}

/** The start is refused: one line per problem, each naming its variable. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration (.env):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const UNITS: Readonly<Record<string, number>> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_ADMIN_PASSWORD = 10;

const isCidr = (s: string): boolean => {
  const [ip, bits, ...rest] = s.split('/');
  if (ip === undefined || rest.length > 0) return false;
  const v = isIP(ip);
  if (v === 0) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (v === 4 ? 32 : 128);
};

/** Parses `env` once; throws `ConfigError` listing every problem. Empty counts as unset. */
export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const bad = (name: string, why: string, got: string | undefined): undefined => {
    problems.push(`${name} ${why}${got === undefined ? '' : `, got "${got}"`}`);
    return undefined;
  };
  const raw = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v === undefined || v === '' ? undefined : v;
  };
  const int = (name: string, fallback: number, min: number, max: number): number => {
    const v = raw(name);
    if (v === undefined) return fallback;
    if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max)
      return bad(name, `must be a whole number from ${min} to ${max}`, v) ?? fallback;
    return Number(v);
  };
  const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const v = raw(name);
    if (v === undefined) return fallback;
    return allowed.find((a) => a === v) ?? bad(name, `must be one of ${allowed.join(', ')}`, v) ?? fallback;
  };
  const list = (name: string, ok: (s: string) => boolean, what: string): string[] => {
    const items = (raw(name) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    for (const i of items) if (!ok(i)) bad(name, `has an entry that is not ${what}`, i);
    return items;
  };

  let publicUrl = '';
  const url = raw('PUBLIC_URL');
  if (url === undefined)
    bad(
      'PUBLIC_URL',
      'is required (the address people open, e.g. https://ueberblick.example.org)',
      undefined,
    );
  else {
    try {
      const u = new URL(url);
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.origin !== url.replace(/\/$/, ''))
        throw new Error('not an origin');
      publicUrl = u.origin;
    } catch {
      bad(
        'PUBLIC_URL',
        'must be an http(s) address without a path, e.g. https://ueberblick.example.org',
        url,
      );
    }
  }
  const httpsMode = oneOf('HTTPS_MODE', HTTPS_MODES, 'proxy');
  const localHosts = list('LOCAL_HOSTS', (s) => isIP(s) !== 0 || HOSTNAME.test(s), 'an IP address or a name');
  if (httpsMode === 'direct' && localHosts.length === 0)
    bad(
      'LOCAL_HOSTS',
      'is required when HTTPS_MODE=direct (the IPs or names people open, for the certificate)',
      undefined,
    );
  const trustedProxies = list('TRUSTED_PROXIES', isCidr, 'an IP address or a CIDR range');

  const adminEmail = raw('ADMIN_EMAIL');
  const adminPassword = raw('ADMIN_PASSWORD');
  if (adminEmail !== undefined && !EMAIL.test(adminEmail))
    bad('ADMIN_EMAIL', 'must be an e-mail address', adminEmail);
  if (adminPassword !== undefined && adminPassword.length < MIN_ADMIN_PASSWORD)
    bad('ADMIN_PASSWORD', `must have at least ${MIN_ADMIN_PASSWORD} characters`, undefined);
  if ((adminEmail === undefined) !== (adminPassword === undefined))
    bad(
      adminEmail === undefined ? 'ADMIN_EMAIL' : 'ADMIN_PASSWORD',
      'is missing: ADMIN_EMAIL and ADMIN_PASSWORD are set together',
      undefined,
    );

  const limit = raw('UPLOAD_LIMIT') ?? '50M';
  const size = /^(\d+)([KMG]?)$/i.exec(limit);
  if (!size || Number(size[1]) === 0) bad('UPLOAD_LIMIT', 'must be a size such as 50M, 512K or 1G', limit);
  const uploadLimit = {
    text: limit.toUpperCase(),
    bytes: size ? Number(size[1]) * (UNITS[(size[2] ?? '').toUpperCase()] ?? 1) : 0,
  };

  const level = raw('UEBERBLICK_LOG_LEVEL');
  const logLevel: LogLevel =
    level === undefined
      ? 'info'
      : (LOG_LEVELS.keys.find((k) => k === level) ??
        bad('UEBERBLICK_LOG_LEVEL', `must be one of ${LOG_LEVELS.keys.join(', ')}`, level) ??
        'info');

  const config: Config = {
    publicUrl,
    httpsMode,
    localHosts,
    httpsPort: int('HTTPS_PORT', 8443, 1, 65535),
    httpPort: int('HTTP_PORT', 8080, 0, 65535),
    trustedProxies,
    appPort: int('APP_PORT', 3000, 1, 65535),
    admin:
      adminEmail !== undefined && adminPassword !== undefined
        ? { email: adminEmail, password: adminPassword }
        : null,
    adminTotp: oneOf('ADMIN_TOTP', SWITCH_VALUES, 'off') === 'on',
    uploadLimit,
    sessionDays: {
      participant: int('SESSION_DAYS_PARTICIPANT', 90, 1, 3650),
      adminRemember: int('SESSION_DAYS_ADMIN_REMEMBER', 30, 1, 3650),
    },
    backupDir: raw('BACKUP_DIR') ?? null,
    timersIntervalMs: int('TIMERS_INTERVAL_S', 30, 0, 86_400) * 1000,
    dataDir: raw('DATA_DIR') ?? './data',
    logLevel,
    mcpSecret: raw('UEBERBLICK_MCP_SECRET') ?? null,
    secureCookies:
      raw('UEBERBLICK_INSECURE_COOKIES') !== '1' &&
      (httpsMode === 'direct' || publicUrl.startsWith('https:')),
    packBuild: raw('PACK_BUILD') !== '0',
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
