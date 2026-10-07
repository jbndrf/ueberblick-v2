import { DocOpenError, openProject, problemsReport } from '@ueberblick/builder';
import type { Principal } from '@ueberblick/server';
import { json, type Call } from '../../lib/server/handlers/http';
import type { DraftSources } from '$lib/admin/draft/draft-source.server';

/** What the handler needs from the app; the route wires the real ones (tests pass fakes). */
export interface ProblemsDeps {
  /** The project key when the caller may use the builder of that project, else the refusing response. */
  authorize(principal: Principal | null, project: string): { readonly projectKey: string } | Response;
  loadDraft(project: string): DraftSources | null;
}

/**
 * GET: the problems of the project's draft, the same list the builder's panel shows (H4).
 * `?locale=de|en` picks the message language (default en).
 */
export function createProblemsHandler(deps: ProblemsDeps) {
  return (call: Pick<Call, 'params' | 'locals'> & { url: URL }): Response => {
    const auth = deps.authorize(call.locals.admin, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    const draft = deps.loadDraft(auth.projectKey);
    if (draft === null)
      return json({ code: 'no_draft', error: 'There is no project file to edit yet.' }, 404);
    try {
      const doc = openProject(draft.templateSrc, draft.overlaySrc);
      return json(problemsReport(doc, call.url.searchParams.get('locale') ?? 'en'));
    } catch (e) {
      if (e instanceof DocOpenError)
        return json({ code: 'not_openable', error: e.message, issues: e.issues }, 422);
      throw e;
    }
  };
}
