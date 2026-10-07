import type { Principal } from '@ueberblick/server';
import { json } from './handlers/http';
import { runtime } from './runtime';

/**
 * Admin authorisation for `/api/admin/p/<project>/*` (provisional): an admin principal with a
 * membership in that project. Roles are template-defined keys, so no fixed role name is required yet;
 * this function is the one seam to tighten that.
 */
export function authorizeAdmin(
  principal: Principal | null,
  projectKey: string,
): { readonly projectKey: string; readonly principal: Principal } | Response {
  if (principal === null) return json({ error: 'Sign in first.' }, 401);
  if (principal.kind !== 'admin') return json({ error: 'Admin access required.' }, 403);
  const rt = runtime();
  const project = rt.project(projectKey);
  if (!project) return json({ error: `Unknown project ${projectKey}.` }, 404);
  if (rt.auth.rolesFor(principal.id, project.id).length === 0)
    return json({ error: 'No access to this project.' }, 403);
  return { projectKey, principal };
}
