import { error } from '@sveltejs/kit';
import { protokollOf, versionCacheFor } from '@ueberblick/server';
import { actorNamesOf } from '$lib/admin/actor-names';
import { actorSourcesOf } from '$lib/admin/actor-names.server';
import { adminOf } from '$lib/admin/projects/admin-guard.server';
import { authorizeAdmin } from '$lib/server/authz';
import { runtime } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

/**
 * The Protokoll of one past run (owner A3, WP-372): the run's own form, filled, read-only. The Objekt must be of the
 * Objektart in the route and the run one of its accepted runs. The server decides what the viewer may read
 * (`protokollOf`); the page only draws it.
 */
export const load: PageServerLoad = ({ locals, url, params }) => {
  adminOf(locals, url);
  const auth = authorizeAdmin(locals.admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'Admin access required.');
  const rt = runtime();
  const db = rt.projectDb(auth.projectKey);
  const feature = db
    .prepare<{ type: string }>('SELECT type FROM features WHERE id = ?')
    .get(params.featureId);
  if (feature === undefined || feature.type !== params.type) error(404, 'Unknown feature.');
  const p = auth.principal;
  const protokoll = protokollOf(db, versionCacheFor(db), params.featureId, params.runId, {
    id: p.id,
    kind: p.kind,
    roles: p.roles,
  });
  if (typeof protokoll === 'string') error(404, 'Unknown protocol.');
  const names = actorNamesOf(actorSourcesOf(auth.projectKey));
  return { project: auth.projectKey, key: params.type, featureId: params.featureId, protokoll, names };
};
