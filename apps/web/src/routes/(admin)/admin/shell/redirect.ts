/**
 * Where an admin goes after signing in, and how a signed-out visit finds the login page. The same-origin check is
 * WP-180's `safeNext` (one place); only the fallback differs.
 */
import { safeNext } from '../../../(builder)/admin-login';

export const ADMIN_HOME = '/admin/projects';

/** `raw` when it is a same-origin path, else the admin home. */
export function redirectTarget(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return ADMIN_HOME;
  return safeNext(raw) === raw ? raw : ADMIN_HOME;
}

/** The login page for a signed-out visit to `pathAndSearch`. */
export const loginUrl = (pathAndSearch: string): string =>
  `/admin/login?redirectTo=${encodeURIComponent(pathAndSearch)}`;
