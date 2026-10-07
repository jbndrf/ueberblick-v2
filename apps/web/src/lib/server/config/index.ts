/**
 * The one reader of the environment (WP-940). `config()` parses `process.env` on first use and keeps the result;
 * the server calls it in `init`, so a bad or missing variable stops the start with one message naming it.
 * Everything else imports from here (`runtime.ts`, `api/mcp/source.ts`); new settings are declared in `vars.ts`.
 */
import { loadConfig, type Config } from './parse';

export { ConfigError, loadConfig, MIN_ADMIN_PASSWORD, type Config, type HttpsMode } from './parse';
export { DECLARED, DOCUMENTED, INTERNAL } from './vars';

let parsed: Config | undefined;

/** The parsed configuration of this process. */
export function config(): Config {
  parsed ??= loadConfig(process.env);
  return parsed;
}
