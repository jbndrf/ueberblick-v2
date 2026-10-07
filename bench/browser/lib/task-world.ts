// Real core.form evaluation for the form scenarios: the fixture compiles like any project file.
// `prepare` runs at page load (the project is compiled once, like on a device), so the measured
// interaction is the open, not the compile.
import { buildFormModel } from '../../../packages/ui/src/form/model';
import { evalContext, formWorld, sessionOptions } from '../../../packages/ui/src/form/form.testing';
import { createFormSession } from '../../../packages/ui/src/form/session';
import { fakeIds, fakeSubmitter, memoryDrafts } from '../../../packages/ui/src/task-sheet/testing/ports';
import { formFixture } from './data';

export function prepare(n: number) {
  const fx = formFixture(n);
  const { config, task } = formWorld(fx);
  return { model: buildFormModel(fx), options: sessionOptions(fx, {}, { locale: 'en' }), config, task };
}
export type Prepared = ReturnType<typeof prepare>;

/** A fresh session per open, like starting a task. */
export const newSession = (p: Prepared) => createFormSession(p.model, p.options);

export function taskSheetProps(p: Prepared) {
  return {
    taskKey: p.task,
    model: p.model,
    config: p.config,
    ctx: evalContext(p.config),
    ids: fakeIds(),
    submitter: fakeSubmitter(),
    drafts: memoryDrafts(),
    online: true,
    locale: 'en',
  };
}
