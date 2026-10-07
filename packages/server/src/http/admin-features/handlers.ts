/**
 * `/api/admin/p/<project>/features` (E-7), the query behind v3's data table (S3-18): one feature type, paged by keyset,
 * searched, sorted and filtered per column, with all lifecycle states and the audit columns. Admin only (`authorizeAdmin`).
 *
 *   GET features?type=<t>&q=<text>&sort=<column>&dir=asc|desc&filter.<column>=<v1>,<v2>&lifecycle=<states>&cursor=<c>&limit=<n>
 *       -> { rows, next, total, referenceNames }  (`referenceNames`: per reference property, the ids on this page to their names)
 *   GET features/distinct?type=<t>&column=<c>&<same q, filter.*, lifecycle>  -> [{ value, count }]  (at most 500)
 *   POST features/<id>/correct  {values, expected_seq?} -> 200 { runId, seq } | 422 | 409  (E-11, see `correct.ts`)
 *   POST features  {type, values} -> 201 { runId, id } | 422 | 404 | 409  (E-12, `create.ts`: a new row, one `$create` run)
 *   POST features/<id>/lifecycle  {state} -> 200 { runId } | 400 | 404 | 422 | 409  (E-13, `create.ts`: delete, one `$lifecycle` run)
 *   GET features/<id>/history?cursor=<c>  -> { runs, next }  (E-9: the feature's runs, newest first, 50 per page, any
 *       lifecycle state; refused runs included; see `history.ts`)
 *
 * Errors use the envelope of `http/shared` (`invalid_query` 400, `not_found` 404, `conflict` 409 before the first deploy).
 */
import type { Clock, Ids } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import type { Db } from '../../db/driver';
import type { Store } from '../../store';
import type { DeployedConfig } from '../../sync';
import { errorResponse } from '../shared/errors';
import { columnsOf, type TypeColumns } from './columns';
import { correctFeature } from './correct';
import { createFeature, setLifecycle } from './create';
import { parseQuery, type FeatureQuery, type Mode } from './query';
import { featureHistory, parseHistoryCursor } from './history';
import { referenceNames } from './reference-names';
import { distinctValues, listFeatures } from './service';

export interface AdminFeaturesCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface AdminFeaturesDeps {
  /** The refusing response (401, 403, 404), or the authorised project key. */
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  db(projectKey: string): Db;
  deployed(projectKey: string): DeployedConfig | undefined;
  /** The project's store: the one write path (`correct` submits a `$correct` run through it). */
  store(projectKey: string): Store;
  readonly ids: Ids;
  readonly clock: Clock;
  /** The name an admin account shows under in the history (accounts live in the control database); null when unknown. */
  adminName(accountId: string): string | null;
}

export interface AdminFeaturesHandlers {
  list(call: AdminFeaturesCall): Response;
  distinct(call: AdminFeaturesCall): Response;
  history(call: AdminFeaturesCall): Response;
  correct(call: AdminFeaturesCall): Promise<Response>;
  create(call: AdminFeaturesCall): Promise<Response>;
  lifecycle(call: AdminFeaturesCall): Promise<Response>;
}

const send = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });

interface Resolved {
  readonly q: FeatureQuery;
  readonly cols: TypeColumns;
  readonly db: Db;
  readonly types: NonNullable<DeployedConfig['config']['file']['types']>;
  readonly def: NonNullable<NonNullable<DeployedConfig['config']['file']['types']>[string]>;
}

export function createAdminFeatureHandlers(deps: AdminFeaturesDeps): AdminFeaturesHandlers {
  function resolve(call: AdminFeaturesCall, mode: Mode): Resolved | Response {
    const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    const deployed = deps.deployed(auth.projectKey);
    if (deployed === undefined) return errorResponse('conflict', 'The project has no deployed config yet.');
    const params = new URL(call.request.url).searchParams;
    const type = params.get('type') ?? '';
    const def = deployed.config.file.types?.[type];
    if (def === undefined) return errorResponse('not_found', `The project has no feature type '${type}'.`);
    const cols = columnsOf(def);
    const parsed = parseQuery(params, mode, cols);
    if (!parsed.ok) return errorResponse('invalid_query', parsed.message);
    return {
      q: parsed.query,
      cols,
      db: deps.db(auth.projectKey),
      types: deployed.config.file.types ?? {},
      def,
    };
  }
  /** The project a write goes to: refused for a non-admin, and before the first deploy (nothing to plan against). */
  function writeTarget(
    call: AdminFeaturesCall,
  ): { projectKey: string; db: Db; deployed: DeployedConfig } | Response {
    const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
    if (auth instanceof Response) return auth;
    const deployed = deps.deployed(auth.projectKey);
    if (deployed === undefined) return errorResponse('conflict', 'The project has no deployed config yet.');
    return { projectKey: auth.projectKey, db: deps.db(auth.projectKey), deployed };
  }
  return {
    list(call) {
      const r = resolve(call, 'list');
      if (r instanceof Response) return r;
      const page = listFeatures(r.db, r.q, r.cols);
      // The names of the references on this page only (O(page), R14); the table shows them instead of ids.
      return send({ ...page, referenceNames: referenceNames(r.db, r.types, r.def, page.rows) });
    },
    distinct(call) {
      const r = resolve(call, 'distinct');
      return r instanceof Response ? r : send(distinctValues(r.db, r.q, r.cols));
    },
    history(call) {
      const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const params = new URL(call.request.url).searchParams;
      for (const key of params.keys())
        if (key !== 'cursor') return errorResponse('invalid_query', `Unknown parameter '${key}'.`);
      const cursor = parseHistoryCursor(params.get('cursor'));
      if (cursor === 'invalid') return errorResponse('invalid_query', 'The cursor is not valid.');
      const db = deps.db(auth.projectKey);
      const id = call.params['feature'] ?? '';
      if (db.prepare('SELECT 1 FROM features WHERE id = ?').get(id) === undefined)
        return errorResponse('not_found', `The project has no feature '${id}'.`);
      return send(
        featureHistory(db, id, cursor, {
          adminName: deps.adminName,
          types: deps.deployed(auth.projectKey)?.config.file.types,
        }),
      );
    },
    async correct(call) {
      const r = writeTarget(call);
      return r instanceof Response
        ? r
        : correctFeature(
            deps,
            { request: call.request, adminId: call.principal?.id ?? '' },
            { ...r, id: call.params['feature'] ?? '' },
          );
    },
    async create(call) {
      const r = writeTarget(call);
      return r instanceof Response
        ? r
        : createFeature(deps, { request: call.request, adminId: call.principal?.id ?? '' }, r);
    },
    async lifecycle(call) {
      const r = writeTarget(call);
      return r instanceof Response
        ? r
        : setLifecycle(
            deps,
            { request: call.request, adminId: call.principal?.id ?? '' },
            { ...r, id: call.params['feature'] ?? '' },
          );
    },
  };
}
