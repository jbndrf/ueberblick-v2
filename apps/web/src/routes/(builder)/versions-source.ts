/**
 * Where the Versions routes reach the project database, the published templates and the pipeline
 * (like `draft-source.ts` for the draft): the one place, so the handlers get plain functions.
 */
import { authorizeAdmin } from '$lib/server/authz';
import { controlCatalog, publishTemplateVersion } from '@ueberblick/server';
import { createVersionsService } from './builder-versions';
import { createVersionsHandlers } from './versions-handlers';
import { runtime } from '$lib/server/runtime';

export const versionsHandlers = createVersionsHandlers({
  authorize: authorizeAdmin,
  service(project) {
    const rt = runtime();
    return createVersionsService(rt.projectDb(project), {
      clock: rt.clock,
      templates: rt.templates,
      catalog: controlCatalog(rt.control),
      afterDeploy: () => rt.services.afterDeploy(project),
      pins: rt.services.pins(project),
    });
  },
  publish(source) {
    const rt = runtime();
    return publishTemplateVersion(rt.control, controlCatalog(rt.control), rt.clock, source);
  },
  now: () => runtime().clock.now(),
});
