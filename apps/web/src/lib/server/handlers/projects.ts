import type { FieldProblem, NewProject, Principal, TemplateListing } from '@ueberblick/server';
import { isRecord, json, readJson, type Call } from './http';

/** What the handlers need of the app; the routes wire the real ones (tests pass fakes). */
export interface ProjectsDeps {
  validate(input: NewProject): readonly FieldProblem[];
  /** Creates the project; `by` is the account id of the signed-in admin. */
  create(input: NewProject, by: string): { readonly id: string; readonly key: string };
  templates(): readonly TemplateListing[];
}

/** Any signed-in admin account may create projects and list templates (A-008 "all admins are equal"). */
function adminOnly(principal: Principal | null): Response | undefined {
  if (principal === null) return json({ error: 'Sign in first.' }, 401);
  if (principal.kind !== 'admin') return json({ error: 'Admin access required.' }, 403);
  return undefined;
}

/** `POST /api/admin/projects` and `GET /api/admin/templates` (WP-309). */
export function createProjectsHandlers(deps: ProjectsDeps) {
  return {
    async POST(call: Pick<Call, 'locals' | 'request'>): Promise<Response> {
      const principal = call.locals.admin;
      const denied = adminOnly(principal);
      if (denied) return denied;
      const body = await readJson(call.request);
      if ('response' in body) return body.response;
      const v = body.value;
      if (!isRecord(v) || typeof v['name'] !== 'string' || typeof v['template'] !== 'string')
        return json({ error: 'Send { "name", "description", "template" }.', problems: [] }, 400);
      const description = v['description'];
      if (description !== undefined && typeof description !== 'string')
        return json({ error: 'The description must be text.', problems: [{ field: 'description' }] }, 400);
      const input: NewProject = { name: v['name'], description: description ?? '', template: v['template'] };
      const problems = deps.validate(input);
      if (problems.length > 0) return json({ error: 'The project cannot be created.', problems }, 400);
      return json(deps.create(input, (principal as Principal).id), 201);
    },

    GET_TEMPLATES(call: Pick<Call, 'locals'>): Response {
      return adminOnly(call.locals.admin) ?? json(deps.templates());
    },
  };
}
