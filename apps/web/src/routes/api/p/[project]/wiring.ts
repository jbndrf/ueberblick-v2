/**
 * The participant surface of `/api/p/<project>/*` (runs, blobs, prefs): these routes resolve a real project or its
 * live preview (`<key>__vorschau`, A-031) through `rt.participantProject`. OGC, MCP, admin, export and the builder
 * keep `rt.project` and stay blind to previews. The sync routes wire the same resolver in `sync/wiring.ts`.
 */
import {
  blobHandlersFor,
  createRunHandlers,
  prefsHandlersFor,
  projectStoresFor,
  type RunHandlers,
} from '@ueberblick/server';
import { runtime, type Runtime } from '$lib/server/runtime';

/** The runtime with the participant resolver as its `project`: what the shared handler factories read. */
let participant: Runtime | undefined;
function participantRuntime(): Runtime {
  participant ??= { ...runtime(), project: (key) => runtime().participantProject(key) };
  return participant;
}

let runs: RunHandlers | undefined;
/** The run handlers over the runtime's own stores (a project has exactly one `Store`). */
export function participantRunHandlers(): RunHandlers {
  runs ??= createRunHandlers({
    auth: runtime().auth,
    log: runtime().log,
    project: (key) => runtime().participantProject(key),
    store: projectStoresFor(runtime()),
  });
  return runs;
}

export const participantBlobHandlers = () => blobHandlersFor(participantRuntime());
export const participantPrefsHandlers = () => prefsHandlersFor(participantRuntime());
