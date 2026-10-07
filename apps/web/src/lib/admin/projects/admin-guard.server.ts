import { redirect } from '@sveltejs/kit';
import type { Principal } from '@ueberblick/server';
import { loginUrl } from '../../../routes/(admin)/admin/shell/redirect';

/**
 * The signed-in admin of a page's own load or action. SvelteKit runs the admin layout's guard in parallel with a
 * page's load, so a page that reads data checks the session itself (same answer as the layout: the sign-in).
 */
export function adminOf(locals: { admin: Principal | null }, url: URL): Principal {
  const principal = locals.admin;
  if (principal?.kind !== 'admin') redirect(303, loginUrl(url.pathname + url.search));
  return principal;
}
