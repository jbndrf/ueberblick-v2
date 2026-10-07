import { instanceStoreFor } from '@ueberblick/server';
import { adminOf } from '../../../../lib/admin/projects/admin-guard.server';
import { runtime } from '../../../../lib/server/runtime';
import { LOCALE_COOKIE, resolveLocale } from '../shell/locale';
import type { PageServerLoad } from './$types';

/**
 * v3 `admin/instance/+page.server.ts` (load): the consent settings and the legal pages. v3 sent everyone but the
 * instance owner away; v4 admin accounts have no owner flag and the API takes any admin (WP-638), so every admin sees it.
 * The writes are the browser's calls on `/api/instance/*`.
 */
export const load: PageServerLoad = ({ locals, url, cookies, request }) => {
  adminOf(locals, url);
  const store = instanceStoreFor(runtime());
  return {
    locale: resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language')),
    settings: store.settings(),
    pages: store.pages().map((p) => ({
      slug: p.slug,
      title: p.title,
      body: p.body,
      sortOrder: p.sortOrder,
      showInConsentFooter: p.showInConsentFooter,
    })),
  };
};
