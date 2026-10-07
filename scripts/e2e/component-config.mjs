// The device projects every UI e2e suite uses (WP-951): one definition for phone and desktop (R1).
import { fileURLToPath } from 'node:url';
import { devices } from '@playwright/test';
import { portEnvFor } from './discover.mjs';

/**
 * v3 switches layout at 768 px (reference map page). `phone` is a touch, mobile Chromium profile below that
 * width; `desktop` is Desktop Chrome at 1280x800. A port is done when its specs pass in both.
 */
export function phoneAndDesktop() {
  return [
    { name: 'phone', use: { ...devices['Pixel 7'], isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ];
}

/** The participant message catalogue the web-backed component harnesses import; one compile serves them all. */
export const PARAGLIDE_COMPILE =
  'npx paraglide-js compile --project ./apps/web/project.inlang --outdir ./apps/web/src/lib/participant/paraglide';
/** Set by run.mjs once it compiled the catalogue, so shards running at once do not rewrite the files under each other. */
export const PARAGLIDE_DONE_VAR = 'UEB_E2E_PARAGLIDE_DONE';

/** The `<compile> && ` prefix of a harness's webServer command; empty when the runner already compiled. */
export function paraglideStep(env = process.env) {
  return env[PARAGLIDE_DONE_VAR] === '1' ? '' : `${PARAGLIDE_COMPILE} && `;
}

/**
 * The server port and output dir of one component suite (WP-1016). The runner sets the port and data-dir env vars
 * `portEnvFor(id)` derives, one pair per copy of a suite, so shards and suites never share a port or a `test-results`
 * dir. Without them (a single run by hand) the port falls back to `fallbackPort` and Playwright's default output dir (test-results beside the config).
 */
export function componentRun(id, fallbackPort, env = process.env) {
  const names = portEnvFor(id);
  const dir = env[names.dir];
  return {
    port: Number(env[names.port] ?? fallbackPort),
    outputDir: dir ? `${dir}/test-results` : 'test-results',
  };
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The Vite dependency cache of one component harness (WP-1040). Harnesses share Vite's default cache
 * (`<package>/node_modules/.vite`); suites starting at once (WP-1016) then rewrite each other's optimized deps and the
 * page reloads mid-test. Inside a runner copy (every shard gets its own `E2E_COMP_<id>_DATA_DIR`) it is
 * `<that dir>/vite-cache`: shards of one suite, and two runs at once, otherwise share one cache, and when one server
 * re-optimizes the other answers `504 Outdated Optimize Dep` until every test times out (e2e:main 2026-10-05,
 * family.e2e). A run by hand without that var uses `<repo>/node_modules/.vite-e2e/<harness path slug>`.
 * Pass the harness config's `import.meta.url`.
 */
export function harnessCacheDir(importMetaUrl, env = process.env) {
  const copies = Object.keys(env).filter((k) => /^E2E_COMP_[A-Z0-9_]+_DATA_DIR$/.test(k) && env[k]);
  if (copies.length === 1) return `${env[copies[0]]}/vite-cache`;
  const dir = fileURLToPath(new URL('.', importMetaUrl));
  const rel = dir.startsWith(REPO_ROOT) ? dir.slice(REPO_ROOT.length) : dir;
  const slug = rel.replace(/[\\/]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${REPO_ROOT}node_modules/.vite-e2e/${slug}`;
}
