import { createLayoutStore } from '@ueberblick/server';
import { authorizeAdmin } from '$lib/server/authz';
import { createLayoutHandlers } from '$lib/server/handlers/builder-layout';
import { runtime } from '$lib/server/runtime';

/** Canvas node positions (WP-366): stored next to the draft, never in a config version. */
const handlers = createLayoutHandlers({
  authorize: authorizeAdmin,
  get: (project, type) => createLayoutStore(runtime().projectDb(project)).get(type),
  replace(project, type, nodes, by) {
    const rt = runtime();
    createLayoutStore(rt.projectDb(project)).replace(type, nodes, by, rt.clock.now());
  },
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
