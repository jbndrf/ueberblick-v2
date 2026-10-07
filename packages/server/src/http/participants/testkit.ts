/** Test support: a control database with one project, a project database and an auth service on a movable clock. */
import { createAuth } from '../../auth/service';
import { participantRolesOf } from '../../auth/participant-roles';
import { openControlDb, openProjectDb } from '../../db/open';
import type { ParticipantsCtx } from './roster';

export function world() {
  const control = openControlDb(':memory:');
  const db = openProjectDb(':memory:', 'demo');
  let t = Date.UTC(2026, 0, 1);
  const now = () => new Date(t);
  control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('id-demo', 'demo', 'Demo', now().toISOString());
  const auth = createAuth({ control, now, participantRoles: (_p, id) => participantRolesOf(db, id) });
  const ctx: ParticipantsCtx = { db, control, auth, projectId: 'id-demo', now };
  return { control, db, auth, ctx, advance: (ms: number) => (t += ms) };
}
