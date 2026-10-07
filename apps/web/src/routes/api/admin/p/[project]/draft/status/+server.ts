import { draftStatus } from '@ueberblick/server';
import { authorizeAdmin } from '$lib/server/authz';
import { runtime } from '$lib/server/runtime';
import { createDraftStatusHandler } from '../status-handler';

export const GET = createDraftStatusHandler({
  authorize: authorizeAdmin,
  status(project) {
    const rt = runtime();
    return draftStatus(rt.projectDb(project), { clock: rt.clock, templates: rt.templates });
  },
});
