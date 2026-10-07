import { authorizeAdmin } from '$lib/server/authz';
import { createDraftHandlers } from '$lib/server/handlers/builder-draft';
import { runtime } from '$lib/server/runtime';
import { ensure, put } from '../../../../../lib/admin/draft/draft-source.server';

/** An accepted save also schedules the preview refresh (debounced, WP-341); a refused one (409, 404) does not. */
const handlers = createDraftHandlers({
  authorize: authorizeAdmin,
  ensure,
  put(project, expected, overlay, by) {
    const r = put(project, expected, overlay, by);
    if (r.ok) runtime().previews.schedulePreviewRefresh(project);
    return r;
  },
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
