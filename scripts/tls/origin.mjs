// One place that turns `PUBLIC_URL` into adapter-node's view of the address (WP-954). SvelteKit compares a form
// POST's Origin with `url.origin`, which adapter-node builds from `ORIGIN` or from request headers, and reads both
// before any app code runs. So the answer has to be in the environment when the app starts, and the config module
// (TypeScript, loaded after adapter-node) cannot give it. This plain module is the bridge; the config module stays
// the validator (a spec holds the two in agreement).
//
//   proxy:  ORIGIN = PUBLIC_URL. The proxy's Host header is not trusted.
//   direct: the TLS front (front.mjs) answers on every LOCAL_HOSTS address and sets X-Forwarded-Proto/-Host to what the
//           browser used, so the app reads them (the app port is not published; only the front reaches it).
//
// Every start path uses it: the Docker entrypoint (`eval "$(node scripts/tls/origin.mjs)"`), the e2e web server
// (playwright.config.ts) and anything else that starts `build/index.js`. Nobody sets ORIGIN by hand.
import { pathToFileURL } from 'node:url';

/** @param {Record<string, string | undefined>} env */
export function originEnv(env) {
  if (env.HTTPS_MODE?.trim() === 'direct') {
    return { PROTOCOL_HEADER: 'x-forwarded-proto', HOST_HEADER: 'x-forwarded-host' };
  }
  const url = env.PUBLIC_URL?.trim();
  if (url === undefined || url === '') return {};
  try {
    return { ORIGIN: new URL(url).origin };
  } catch {
    return {};
  }
}

const quote = (v) => `'${v.replaceAll("'", `'\\''`)}'`;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // shell lines for `eval`
  for (const [k, v] of Object.entries(originEnv(process.env))) console.log(`export ${k}=${quote(v)}`);
}
