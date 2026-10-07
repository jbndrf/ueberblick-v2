/** The participant API over the runtime: the same auth service, project databases and config cache as run and sync. */
import { configCacheFor, instanceStoreFor, readSessionCookie, versions } from '@ueberblick/server';
import { projectInfoOf } from '../../../lib/admin/settings/project-info';
import { runtime } from '$lib/server/runtime';
import { createParticipantApi, type ParticipantApi } from './handlers';

let api: ParticipantApi | undefined;

export function participantApi(): ParticipantApi {
  api ??= createParticipantApi({
    authenticate: (req) => {
      const who = runtime().auth.authenticate(readSessionCookie(req, 'participant'));
      return who?.kind === 'participant' ? who : null; // a cookie that holds the other kind counts as absent
    },
    project: (key) => runtime().participantProject(key),
    projectKeyOf: (id) => runtime().participantProjectOf(id)?.key,
    projectInfo: (id) => {
      const project = runtime().participantProjectOf(id);
      if (project === undefined) return undefined;
      // A-036: the deployed config's `branding` (Anzeigename, Projektsymbol); the project name and no icon without it.
      return projectInfoOf(project.name, runtime().services.deployed(project.key)?.config.file.branding);
    },
    participantName: (key, id) =>
      runtime()
        .projectDb(key)
        .prepare<{ name: string | null }>('SELECT name FROM participants WHERE id = ?')
        .get(id)?.name ?? null,
    contact: (key, id) => {
      const row = runtime()
        .projectDb(key)
        .prepare<{ attrs: string | null }>('SELECT attrs FROM participants WHERE id = ?')
        .get(id);
      const attrs = (row?.attrs ? JSON.parse(row.attrs) : {}) as Record<string, unknown>;
      const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
      return { email: text(attrs['email']), phone: text(attrs['phone']) };
    },
    legalPages: () => instanceStoreFor(runtime()).pages(),
    sessionExpiresAt: (req) =>
      runtime().auth.sessionExpiry(readSessionCookie(req, 'participant')) ?? undefined,
    // An expired token cannot be exchanged any more, so it is not offered as a login.
    credential: (projectId, participantId) => {
      const c = runtime().auth.currentCredential(projectId, participantId);
      return c !== null && (c.expiresAt === null || c.expiresAt > new Date().toISOString()) ? c : undefined;
    },
    configs: (key) => {
      const db = runtime().projectDb(key);
      return {
        ...configCacheFor(db),
        statusOf: (n) => versions(db).find((v) => v.version === n)?.status,
      };
    },
  });
  return api;
}
