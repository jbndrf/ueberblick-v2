import { config } from '$lib/server/config';
import { setupPageData } from '$lib/server/tls/downloads';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ request }) => {
  const c = config();
  return setupPageData(c.dataDir, c.publicUrl, request.headers.get('accept-language'));
};
