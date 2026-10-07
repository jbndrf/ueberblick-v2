/**
 * The one resolver for actor ids in the admin tables ("Erstellt von", participant columns, their filter lists). A run's
 * actor is a participant, an admin account, an import (`import:<adminId>`, the admin who ran the import) or the system
 * (rules, timers, migrations). v3 showed only participants (`created_by_name` from the participant map,
 * `workflows/[workflowId]/+page.server.ts:222`, `lib/admin/workflow-rows.ts:202`); an id it could not resolve showed
 * empty. Here every kind of actor has a readable name and an unknown id shows as it is.
 */

export const SYSTEM_ACTOR_ID = 'system';
export const IMPORT_ACTOR_PREFIX = 'import:';

export interface ActorSources {
  readonly participants: readonly { readonly id: string; readonly name: string | null }[];
  readonly admins: readonly { readonly id: string; readonly email: string | null }[];
}

export interface ActorLabels {
  /** The system actor's name (rules, timers, migrations). */
  readonly system: string;
  /** "Import (<admin>)". */
  readonly importBy: (admin: string) => string;
}

/** Actor id to name for the accounts the project knows (the server sends this; the labels come with the locale). */
export function actorNamesOf(sources: ActorSources): Record<string, string> {
  const names: Record<string, string> = {};
  for (const p of sources.participants) if (p.name) names[p.id] = p.name;
  for (const a of sources.admins) if (a.email) names[a.id] = a.email;
  return names;
}

/** The name of one actor id; an id that is in no list shows as it is. */
export function actorName(names: Readonly<Record<string, string>>, id: string, labels: ActorLabels): string {
  if (id === SYSTEM_ACTOR_ID) return labels.system;
  if (id.startsWith(IMPORT_ACTOR_PREFIX)) {
    const admin = names[id.slice(IMPORT_ACTOR_PREFIX.length)];
    return admin === undefined ? id : labels.importBy(admin);
  }
  return names[id] ?? id;
}
