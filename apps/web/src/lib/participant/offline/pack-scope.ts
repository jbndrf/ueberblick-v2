// Reads the pack scope (project and person) from the writer worker's name (a query string). A missing or empty value throws: writing
// into a shared bucket the reader never reads would silently lose the pack (R11).
import type { PackScope } from '@ueberblick/client';

export function packScopeFromName(name: string): PackScope {
  const q = new URLSearchParams(name);
  const project = q.get('project');
  const participant = q.get('participant');
  if (!project) throw new Error('pack writer: missing "project" in the worker name');
  if (!participant) throw new Error('pack writer: missing "participant" in the worker name');
  return { project, participant };
}
