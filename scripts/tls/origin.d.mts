/**
 * What adapter-node needs to know about the address people open (WP-954): `{ ORIGIN }` in proxy mode, the two
 * `*_HEADER` names in direct mode, `{}` when `PUBLIC_URL` is missing or no origin (the config module then stops the
 * start with its message).
 */
export function originEnv(env: Record<string, string | undefined>): Record<string, string>;
