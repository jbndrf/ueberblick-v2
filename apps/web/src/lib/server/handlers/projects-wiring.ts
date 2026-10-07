import { createProjectFromTemplate, listTemplates, validateNewProject } from '@ueberblick/server';
import { runtime } from '../runtime';
import { createProjectsHandlers } from './projects';

/** The project handlers over the real runtime: control.db and lazily opened project databases. */
export const projectsHandlers = createProjectsHandlers({
  validate: (input) => validateNewProject(runtime().control, input, runtime().clock),
  create: (input, by) =>
    createProjectFromTemplate(runtime().control, runtime().projectDb, input, by, runtime().clock),
  templates: () => listTemplates(runtime().control, runtime().clock),
});
