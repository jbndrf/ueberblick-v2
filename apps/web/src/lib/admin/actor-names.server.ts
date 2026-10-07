import { listParticipants } from '@ueberblick/server';
import { runtime } from '../server/runtime';
import type { ActorSources } from './actor-names';

/** The accounts and participants the admin tables name actors by (one read per page load, not per row). */
export function actorSourcesOf(project: string): ActorSources {
  const rt = runtime();
  return {
    participants: listParticipants({ db: rt.projectDb(project) }),
    admins: rt.control.prepare<{ id: string; email: string | null }>('SELECT id, email FROM accounts').all(),
  };
}
