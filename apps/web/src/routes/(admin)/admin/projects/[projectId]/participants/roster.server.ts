/**
 * The Teilnehmende page's data (v3 `participants/+page.server.ts`, load): the visible roster with each person's
 * readable login token (WP-607), the roles, and the admin's own columns. Called by the page load; it reads the
 * server directly, there is no device-data rule for admin pages.
 */
import { PARTICIPANT_COLUMN_TYPES, listColumns, listRoster } from '@ueberblick/server';
import { runtime } from '../../../../../../lib/server/runtime';
import { roleOptions } from './draft-roles.server';
import type { ParticipantsPageData } from '../../../../../../lib/admin/participants/types';

export function loadParticipants(projectKey: string, guests: boolean, locale: string): ParticipantsPageData {
  const rt = runtime();
  const project = rt.project(projectKey);
  if (!project) throw new Error(`unknown project ${projectKey}`);
  const db = rt.projectDb(projectKey);
  const ctx = {
    db,
    control: rt.control,
    auth: rt.auth,
    projectId: project.id,
    now: () => new Date(rt.clock.now()),
  };
  const people = listRoster(ctx, { guests }).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone,
    roles: p.roles as readonly string[],
    attrs: p.attrs,
    disabledAt: p.disabledAt,
    selfJoined: p.selfJoined,
    token: rt.auth.currentCredential(project.id, p.id)?.token ?? null,
  }));
  return {
    people,
    roles: roleOptions(projectKey, locale),
    columns: listColumns(db),
    columnTypes: [...PARTICIPANT_COLUMN_TYPES.keys],
    showGuests: guests,
  };
}
