/**
 * The per-tool message stream routes (B-020, WP-682): `tools/<tool>` and `tools/<tool>/read`. Like the sync wiring they
 * resolve the live preview too (`participantProject`, A-031): chat works in a preview like every participant route. The
 * tool bell is the runtime's (`services.toolBell`): the sync events handler subscribes to it to write `event: tool` (docs/07).
 */
import { createChatHandlers, type ChatHandlers } from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';

let handlers: ChatHandlers | undefined;
export function toolHandlers(): ChatHandlers {
  const rt = runtime();
  handlers ??= createChatHandlers({
    auth: rt.auth,
    project: (key) => rt.participantProject(key),
    clock: rt.clock,
    projectDb: (key) => rt.projectDb(key),
    deployed: (key) => rt.services.deployed(key),
    ringTool: (project, tool) => rt.services.toolBell.ring(project, tool),
  });
  return handlers;
}
