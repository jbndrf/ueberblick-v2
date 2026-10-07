/**
 * `/api/admin/p/<project>/import` (E-10, WP-363): the engine of v3's CSV import wizard. Admin only (`authorizeAdmin`),
 * project-scoped like the other admin endpoints. The body of both POSTs is multipart: `file`, `mapping` (JSON, see
 * `ImportMapping` in `io/contract.ts`, with `constants`) and optionally `format` (else the file extension names it).
 *
 *   POST import/plan        -> { counts, problems, preview }          dry run, writes nothing
 *   POST import  (+ mode: atomic|skip, replace: true|false)  -> 202 { job }
 *   GET  import/<job>       -> { job: { state, rows_done, rows_total, imported, outcome, problems, problem_count, error, ... } }
 *
 * Errors: `{ error: { code, message } }` with the codes of `IMPORT_ERRORS` (`not_published`, `replace_needs_atomic`,
 * `file_too_large`, `invalid_import`, `unknown_job`); 401, 403 and 404 come from the admin check.
 */
import { IMPORT_ERRORS, type ImportErrorCode } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import type { DeployedConfig } from '../../sync';
import { jsonResponse } from '../shared/errors';
import { parseImport } from './parse';
import type { ImportService } from './service';

export interface AdminImportCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface AdminImportDeps {
  /** The refusing response (401, 403, 404), or the authorised project key. */
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  deployed(projectKey: string): DeployedConfig | undefined;
  readonly service: ImportService;
  /** Upload cap; default `IMPORT_LIMITS.maxFileBytes` (tests lower it). */
  readonly maxFileBytes?: number;
}

export interface AdminImportHandlers {
  plan(call: AdminImportCall): Promise<Response>;
  start(call: AdminImportCall): Promise<Response>;
  status(call: AdminImportCall): Response;
}

const refuse = (code: ImportErrorCode, message: string): Response =>
  jsonResponse({ error: { code, message } }, IMPORT_ERRORS.get(code).status);

export function createAdminImportHandlers(deps: AdminImportDeps): AdminImportHandlers {
  function resolve(call: AdminImportCall): { projectKey: string; deployed: DeployedConfig } | Response {
    const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    const deployed = deps.deployed(auth.projectKey);
    if (deployed === undefined)
      return refuse('not_published', 'The project has no deployed version yet; publish it before importing.');
    return { projectKey: auth.projectKey, deployed };
  }
  const noStore = (res: Response): Response => {
    res.headers.set('cache-control', 'private, no-store');
    return res;
  };
  return {
    async plan(call) {
      const r = resolve(call);
      if (r instanceof Response) return r;
      const parsed = await parseImport(call.request, deps.maxFileBytes);
      if (!parsed.ok) return refuse(parsed.code, parsed.message);
      return noStore(jsonResponse(deps.service.dryRun(r.deployed, call.principal?.id ?? '', parsed.value)));
    },
    async start(call) {
      const r = resolve(call);
      if (r instanceof Response) return r;
      const parsed = await parseImport(call.request, deps.maxFileBytes);
      if (!parsed.ok) return refuse(parsed.code, parsed.message);
      if (parsed.value.replace && (parsed.value.mode ?? 'atomic') !== 'atomic')
        return refuse('replace_needs_atomic', '`replace` needs `mode: atomic`: it is all or nothing.');
      const job = deps.service.start(r.projectKey, r.deployed, call.principal?.id ?? '', parsed.value);
      return noStore(jsonResponse({ job }, 202));
    },
    status(call) {
      const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const job = deps.service.job(auth.projectKey, call.params['job'] ?? '');
      if (job === undefined) return refuse('unknown_job', 'No such import job.');
      return noStore(jsonResponse({ job }));
    },
  };
}
