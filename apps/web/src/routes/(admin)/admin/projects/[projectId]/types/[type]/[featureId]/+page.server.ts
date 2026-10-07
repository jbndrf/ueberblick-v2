import { error } from '@sveltejs/kit';
import { CORRECT_TASK } from '@ueberblick/core';
import { columnsOf, featureHistory, featureRow } from '@ueberblick/server';
import { adminOf } from '../../../../../../../../lib/admin/projects/admin-guard.server';
import { actorSourcesOf } from '../../../../../../../../lib/admin/actor-names.server';
import { loadDataPage } from '../../../../../../../../lib/admin/data/load.server';
import { adminName } from '../../../../../../../../lib/server/handlers/admin-features';
import { authorizeAdmin } from '../../../../../../../../lib/server/authz';
import { runtime } from '../../../../../../../../lib/server/runtime';
import { adminMessage } from '../../../../../shell/messages';
import type { PageServerLoad } from './$types';

/**
 * One Objekt (v3 `instances/[id]/+page.server.ts`): the feature as the data table's row (any lifecycle state), the
 * newest page of its history, the type as deployed, the roster (names) and the base layer for the Standort pane. The
 * Objekt must be of the Objektart in the route. Older history pages come from the history API ("Mehr laden").
 */
export const load: PageServerLoad = ({ locals, url, params }) => {
  adminOf(locals, url);
  const auth = authorizeAdmin(locals.admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'Admin access required.');
  const rt = runtime();
  const deployed = rt.services.deployed(auth.projectKey);
  const def = deployed?.config.file.types?.[params.type];
  if (def === undefined) error(404, 'Unknown feature type.');
  const db = rt.projectDb(auth.projectKey);
  const found = featureRow(db, params.featureId, (type) => {
    const d = deployed?.config.file.types?.[type];
    return d === undefined ? undefined : columnsOf(d);
  });
  if (found === undefined || found.type !== params.type) error(404, 'Unknown feature.');
  const page = loadDataPage(
    {
      deployedType: () => def,
      deployedMap: () => deployed?.config.file.map,
      actors: actorSourcesOf,
      deployedRoles: () => deployed?.config.file.roles,
    },
    auth.projectKey,
    params.type,
  );
  return {
    project: auth.projectKey,
    key: params.type,
    row: found.row,
    history: featureHistory(db, params.featureId, undefined, {
      adminName,
      types: deployed?.config.file.types,
    }),
    // The built-in Admin-Korrektur is no task of the config; its runs show under its own name.
    tasks: {
      [CORRECT_TASK]: {
        label: { de: adminMessage('de', 'correct_task_label'), en: adminMessage('en', 'correct_task_label') },
        on: '$none',
      },
      ...deployed?.config.file.tasks,
    },
    ...page,
  };
};
