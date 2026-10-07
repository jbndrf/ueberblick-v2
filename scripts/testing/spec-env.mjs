// The one env for specs that spawn our scripts (WP-919, R1). The land, the check gate and the steps runner export
// a dozen UEB_* variables; a child that inherits them behaves differently inside a land than in a plain shell.
// `specEnv()` is process.env minus every UEB_* key, then the overrides. PATH, HOME and so on stay.
// scripts/testing/spec-env.spec.ts enforces that every spawning spec (scripts/**/*.spec.{ts,mjs}) goes through it.
// It reads the call's own option object: spreads, Object.assign, a conditional branch or process['env'] handing
// over raw process.env fail it; a nested { env } does not count. Aliases and promisified wrappers are out of scope.

/** A copy of process.env without any `UEB_*` key, then `overrides` applied (a spec that needs a UEB_* var sets it here). */
export function specEnv(overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('UEB_')) env[key] = value;
  }
  return { ...env, ...overrides };
}
