/**
 * The two project-file endpoints of the Projekte page (WP-383, S3-7):
 *
 *   GET  /api/admin/projects/<project>/schema  -> the effective file as YAML (attachment) | 409 { problems }
 *   POST /api/admin/projects/import            -> multipart `file` (+ optional `name`)
 *                                                 201 { key, id } | 400 | 411 | 413 | 422 { problems }
 *
 * Export is scoped to the project (membership); import is open to any admin, like "Projekt erstellen".
 */
import { PROJECT_FILE_LIMITS } from '@ueberblick/core';
import { stringify } from 'yaml';
import type { Principal } from '../../auth/contract';
import { jsonResponse } from '../shared/errors';
import type { EffectiveResult, ProjectFileImportOutcome } from './project-file';

export interface AdminProjectsDeps {
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  /** The project's draft (else deployed version) with template and overlay resolved. */
  effectiveFile(projectKey: string): EffectiveResult;
  importFile(text: string, by: string, name: string | undefined): ProjectFileImportOutcome;
  /** Upload cap; default `PROJECT_FILE_LIMITS.maxBytes` (tests lower it). */
  readonly maxBytes?: number | undefined;
}

export interface AdminProjectsCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

/** What a multipart body adds to the file itself (boundaries, field headers, the optional name). */
const FORM_OVERHEAD = 64 * 1024;

export function createAdminProjectsHandlers(deps: AdminProjectsDeps) {
  const cap = deps.maxBytes ?? PROJECT_FILE_LIMITS.maxBytes;
  return {
    GET_SCHEMA(call: AdminProjectsCall): Response {
      const auth = deps.authorizeAdmin(call.principal, call.params['key'] ?? '');
      if (auth instanceof Response) return auth;
      const r = deps.effectiveFile(auth.projectKey);
      if (!r.ok)
        return jsonResponse({ error: 'The project file cannot be exported.', problems: r.problems }, 409);
      return new Response(stringify(r.file), {
        headers: {
          'content-type': 'application/yaml; charset=utf-8',
          'content-disposition': `attachment; filename="${auth.projectKey}-schema.yaml"`,
          'cache-control': 'private, no-store',
        },
      });
    },

    async POST_IMPORT(call: AdminProjectsCall): Promise<Response> {
      const principal = call.principal;
      if (principal === null) return jsonResponse({ error: 'Sign in first.' }, 401);
      if (principal.kind !== 'admin') return jsonResponse({ error: 'Admin access required.' }, 403);
      // The multipart body is buffered by `formData()`, so the declared size is checked first (as the blob upload does);
      // a body that declares none cannot be bounded and is refused (411).
      const declared = call.request.headers.get('content-length');
      if (declared === null) return jsonResponse({ error: 'Send a Content-Length.', problems: [] }, 411);
      if (!(Number(declared) <= cap + FORM_OVERHEAD))
        return jsonResponse({ error: 'The file is too large.', problems: [] }, 413);
      let form: FormData;
      try {
        form = await call.request.formData();
      } catch {
        return jsonResponse({ error: 'Send the project file as multipart form data.', problems: [] }, 400);
      }
      const file = form.get('file');
      if (!(file instanceof File))
        return jsonResponse({ error: 'The form needs a `file`.', problems: [] }, 400);
      if (file.size > cap) return jsonResponse({ error: 'The file is too large.', problems: [] }, 413);
      const name = form.get('name');
      const typed = typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
      const r = deps.importFile(await file.text(), principal.id, typed);
      if (r.ok) return jsonResponse({ key: r.key, id: r.id }, 201);
      return jsonResponse({ error: 'The file cannot be imported.', problems: r.problems }, 422);
    },
  };
}
