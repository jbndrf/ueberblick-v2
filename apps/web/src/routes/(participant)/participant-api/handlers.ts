/**
 * What a participant's device needs before it can work offline (WP-550): who it is, which project, and the
 * compiled config it hydrates (`CompiledConfigData`, A-005; the compiler never runs on the device).
 *
 *  - `GET /participant-api/bootstrap`: the session's participant (id, name, roles, e-mail, phone), the info pages, the legal pages, the project (key, display name,
 *    icon, `preview`: true on a preview login), the session expiry, the `access` value of the pull header (WP-798), the participant's own login, the deployed version and its compiled form.
 *  - `GET /participant-api/<project>/config/<version>`: one stored version's compiled form (`ConfigFetcher` of the device).
 *
 * Handlers are plain `Request -> Response`; the route files only delegate, so this is tested without SvelteKit.
 */
import { orderedInfoPages, serialize, type TemplateFile } from '@ueberblick/core';
import type { ConfigVersionStatus } from '@ueberblick/core/registry';
import {
  accessOf,
  errorResponse,
  isPreviewKey,
  jsonResponse,
  type ConfigCache,
  type Handler,
  type Principal,
} from '@ueberblick/server';
import type { InfoPageData } from '../../../lib/participant/http';

export interface ParticipantApiDeps {
  /** The session cookie of the request as a principal, or null. */
  authenticate(req: Request): Principal | null;
  /** The project row for a key. */
  project(key: string): { readonly id: string; readonly key: string } | undefined;
  /** The key of a project id (a participant session knows the id). */
  projectKeyOf(projectId: string): string | undefined;
  /** The project's display name and icon (blob sha), or undefined for an unknown id. */
  projectInfo(projectId: string): { readonly displayName: string; readonly icon: string | null } | undefined;
  /** The participant's name, or null when none is set (the id is shown then). */
  participantName(projectKey: string, participantId: string): string | null;
  /** The participant's roster e-mail and phone (null when none). */
  contact(
    projectKey: string,
    participantId: string,
  ): { readonly email: string | null; readonly phone: string | null };
  /** The instance's legal pages in the operator's order (WP-638). */
  legalPages(): readonly { readonly slug: string; readonly title: string; readonly body: string }[];
  /** When the session of this request ends, or undefined when it has none any more. */
  sessionExpiresAt(req: Request): string | undefined;
  /** The participant's active token, or undefined when none can be exchanged any more. */
  credential(projectId: string, participantId: string): { readonly token: string } | undefined;
  configs(projectKey: string): Pick<ConfigCache, 'version' | 'deployed'> & {
    /** The stored status of a version: only a version that was deployed (deployed or retired) is served. */
    statusOf(version: number): ConfigVersionStatus | undefined;
  };
}

export interface ParticipantApi {
  bootstrap(req: Request): Promise<Response>;
  config: Handler<{ project?: string; version?: string }>;
}

const noStore = (res: Response): Response => {
  res.headers.set('cache-control', 'no-store');
  return res;
};

/** The info pages in sort order (stable: equal or absent orders keep the authored order). */
function infoPagesOf(pages: TemplateFile['info_pages']): readonly InfoPageData[] {
  return orderedInfoPages(pages).map(({ key, page }) => ({ key, title: page.title, content: page.content }));
}

export function createParticipantApi(deps: ParticipantApiDeps): ParticipantApi {
  return {
    async bootstrap(req) {
      const principal = deps.authenticate(req);
      if (principal === null) return errorResponse('unauthenticated', 'Sign in first.');
      const project = principal.projectId === null ? undefined : deps.projectKeyOf(principal.projectId);
      if (principal.kind !== 'participant' || project === undefined)
        return errorResponse('forbidden', 'Only a participant of a project has an app.');
      const info = deps.projectInfo(principal.projectId ?? '');
      const expiresAt = deps.sessionExpiresAt(req);
      if (info === undefined || expiresAt === undefined)
        return errorResponse('unauthenticated', 'Sign in first.');
      const deployed = deps.configs(project).deployed();
      if (deployed === undefined) return errorResponse('conflict', 'The project has no deployed config yet.');
      const credential = deps.credential(principal.projectId ?? '', principal.id);
      return noStore(
        jsonResponse({
          // `preview`: the session is a preview login (the project key is `<key>__vorschau`, A-031); the one place that knows it (WP-373).
          project: {
            key: project,
            displayName: info.displayName,
            icon: info.icon,
            preview: isPreviewKey(project),
          },
          participant: {
            id: principal.id,
            name: deps.participantName(project, principal.id) ?? principal.id,
            roles: principal.roles,
            ...deps.contact(project, principal.id),
          },
          // The baseline of the pull header's `access` (WP-798): the same function, so a role change before the first pull is seen.
          access: accessOf(principal),
          session: { expiresAt },
          // The same link the admin's QR carries: /login?token=…, the form the sign-in page reads.
          login:
            credential === undefined
              ? null
              : {
                  token: credential.token,
                  link: `${new URL(req.url).origin}/login?token=${encodeURIComponent(credential.token)}`,
                },
          infoPages: infoPagesOf(deployed.config.file.info_pages),
          legalPages: deps.legalPages().map(({ slug, title, body }) => ({ slug, title, body })),
          version: deployed.version,
          compiled: serialize(deployed.config),
        }),
      );
    },

    async config(req, { params }) {
      const principal = deps.authenticate(req);
      if (principal === null) return errorResponse('unauthenticated', 'Sign in first.');
      const project = deps.project(params.project ?? '');
      if (project === undefined || principal.kind !== 'participant' || principal.projectId !== project.id)
        return errorResponse('forbidden', 'No access to this project.');
      const text = params.version ?? '';
      const version = /^[1-9]\d*$/.test(text) ? Number(text) : undefined;
      const configs = deps.configs(project.key);
      const status = version === undefined ? undefined : configs.statusOf(version);
      // A draft is the builder's work in progress, not the participants' config (the whole compiled config goes to
      // every participant of the project so plan can run offline: an accepted trade-off, see the WP-550 Log).
      const config =
        version === undefined || (status !== 'deployed' && status !== 'retired')
          ? undefined
          : configs.version(version);
      if (config === undefined) return errorResponse('not_found', 'No such config version.');
      return noStore(jsonResponse(serialize(config)));
    },
  };
}
