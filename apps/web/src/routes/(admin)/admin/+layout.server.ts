import { redirect } from '@sveltejs/kit';
import { resolveLocale, LOCALE_COOKIE } from './shell/locale';
import { projectIdOf, type ShellProject } from './shell/nav';
import { emailOf, projectsOf, typesOf } from './shell/projects.server';
import type { SidebarType } from './shell/sidebar-types';
import { loginUrl } from './shell/redirect';
import type { LayoutServerLoad } from './$types';

/**
 * The admin guard and the shell's data (v3 `+layout.server.ts`). The login page is open; every other admin page
 * needs an admin session: without one it goes to `/admin/login?redirectTo=<path>` (a participant session of the same browser stays untouched).
 */
export const load: LayoutServerLoad = ({ locals, url, request, cookies }) => {
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  const none = {
    account: null,
    projects: [] as ShellProject[],
    currentProject: null,
    types: [] as SidebarType[],
    locale,
  };
  if (url.pathname === '/admin/login') return none;
  const principal = locals.admin;
  // Only the admin cookie counts here (WP-705): a participant session in the same browser is not an admin session.
  if (principal?.kind !== 'admin') redirect(303, loginUrl(url.pathname + url.search));
  const projects = projectsOf(principal.id);
  const id = projectIdOf(url.pathname);
  const currentProject = projects.find((p) => p.key === id) ?? null;
  return {
    account: { email: emailOf(principal.id) ?? '' },
    projects,
    currentProject,
    // The open project's Objektarten and Tabellen for the sidebar, from its draft (WP-343).
    types: currentProject ? typesOf(currentProject.key, principal.id, locale) : [],
    locale,
  };
};
