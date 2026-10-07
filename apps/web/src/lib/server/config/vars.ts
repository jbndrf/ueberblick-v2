/**
 * Every environment variable the app reads, declared once. `DOCUMENTED` is what an admin sets in `.env`
 * (`.env.example` lists exactly these, a test compares them); `INTERNAL` is for tests, tools and the image.
 * `parse.ts` validates both, `index.ts` hands out the parsed result: nothing else reads `process.env`.
 */

/** How the app is reached: behind the admin's HTTPS proxy, or serving local HTTPS itself (WP-941). */
export const HTTPS_MODES = ['proxy', 'direct'] as const;
/** The two-state switches (`ADMIN_TOTP`). */
export const SWITCH_VALUES = ['off', 'on'] as const;

/** The variables of `.env.example`, in its order. */
export const DOCUMENTED = [
  'PUBLIC_URL',
  'HTTPS_MODE',
  'LOCAL_HOSTS',
  'HTTPS_PORT',
  'HTTP_PORT',
  'TRUSTED_PROXIES',
  'APP_PORT',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'ADMIN_TOTP',
  'UPLOAD_LIMIT',
  'SESSION_DAYS_PARTICIPANT',
  'SESSION_DAYS_ADMIN_REMEMBER',
  'BACKUP_DIR',
  'TIMERS_INTERVAL_S',
] as const;

/** Not for admins: the data folder (the image sets `/data`), the log level, the MCP key, the test-only cookie switch and the offline-pack build switch (`PACK_BUILD=0` is off, WP-351). */
export const INTERNAL = [
  'DATA_DIR',
  'UEBERBLICK_LOG_LEVEL',
  'UEBERBLICK_MCP_SECRET',
  'UEBERBLICK_INSECURE_COOKIES',
  'PACK_BUILD',
] as const;

/** Every name the config module declares. */
export const DECLARED: readonly string[] = [...DOCUMENTED, ...INTERNAL];
