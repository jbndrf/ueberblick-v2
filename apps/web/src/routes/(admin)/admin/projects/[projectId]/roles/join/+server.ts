import type { RequestHandler } from '@sveltejs/kit';
import { joinSwitch } from '../../../../../../../lib/server/handlers/admin-join';
import { loadRoles } from '../roles.server';

/** v3 `toggleSelfJoinable`: the switch applies at once and never touches the project file (Q14). */
export const PUT: RequestHandler = (event) =>
  joinSwitch(event, {
    knownRole: (projectKey, role) => loadRoles(projectKey, 'de').roles.some((r) => r.key === role),
  });
