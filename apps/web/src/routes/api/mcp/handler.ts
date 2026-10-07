/**
 * The MCP endpoint (H4, WP-211): `POST /api/mcp/<project>` takes one JSON-RPC message, and
 * `POST /api/mcp/<project>/confirm` is the human step that issues the token `apply` needs (O15).
 * Both need an admin of the project (`authorizeAdmin`, A-008), as the builder API does.
 *
 * The draft is read and written through the draft handlers of `GET`/`PUT /builder-api/<project>/draft`
 * (called in process, with the same store functions), so the size cap, the revision compare-and-swap and
 * the 409 are the ones the builder gets: there is no second write path (R3, A-011).
 */
import {
  createMcpServer,
  issueConfirmation,
  JSON_RPC_ERRORS,
  type ConfirmationPort,
  type DraftPort,
} from '@ueberblick/builder';
import type { Principal } from '@ueberblick/server';
import { createDraftHandlers, readCapped, type DraftDeps } from '../../../lib/server/handlers/builder-draft';
import { json, type Call } from '../../../lib/server/handlers/http';

/** A JSON-RPC message with ops is small; a megabyte is far above any real one. */
export const MAX_MCP_BYTES = 1_000_000;

export interface McpDeps extends Pick<DraftDeps, 'authorize' | 'ensure' | 'put'> {
  /** The source text of the template a draft is pinned to; undefined when it is not known. */
  templateSource(template: string, version: string): string | undefined;
  readonly confirmation: ConfirmationPort;
}

type Auth = { readonly projectKey: string; readonly principal: Principal };
type Request_ = Pick<Call, 'params' | 'locals' | 'request'>;

/** The draft port of one caller: the draft handlers with the caller already authorised. */
function draftPort(deps: McpDeps, auth: Auth): DraftPort {
  const handlers = createDraftHandlers({ authorize: () => auth, ensure: deps.ensure, put: deps.put });
  const params = { project: auth.projectKey };
  const locals = { admin: auth.principal } as Call['locals'];
  return {
    async read() {
      const res = handlers.GET({ params, locals });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok)
        return {
          ok: false,
          code: typeof body['code'] === 'string' ? body['code'] : 'no_draft',
          message: typeof body['error'] === 'string' ? body['error'] : 'There is no draft.',
        };
      const templateSrc = deps.templateSource(String(body['template']), String(body['templateVersion']));
      if (templateSrc === undefined)
        return { ok: false, code: 'no_template', message: 'The template of the draft is not available.' };
      return {
        ok: true,
        draft: { templateSrc, overlaySrc: String(body['overlay']), revision: Number(body['revision']) },
      };
    },
    async write(overlay, revision) {
      const res = await handlers.PUT({
        params,
        locals,
        request: new Request('http://mcp.invalid/draft', {
          method: 'PUT',
          body: JSON.stringify({ overlay, revision }),
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (res.ok) return { ok: true, revision: Number(body['revision']) };
      if (res.status === 409)
        return {
          ok: false,
          code: 'stale_revision',
          currentRevision: Number((body['draft'] as { revision?: number } | undefined)?.revision),
        };
      return {
        ok: false,
        code: 'write_refused',
        status: res.status,
        message: typeof body['error'] === 'string' ? body['error'] : 'The draft was not written.',
      };
    },
  };
}

const rpcError = (code: number, message: string, status = 200): Response =>
  json({ jsonrpc: '2.0', id: null, error: { code, message } }, status);

export function createMcpHandlers(deps: McpDeps) {
  return {
    /** One JSON-RPC message; a notification is answered with 202 and no body. */
    async POST(call: Request_): Promise<Response> {
      const auth = deps.authorize(call.locals.admin, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const text = await readCapped(call.request, MAX_MCP_BYTES);
      if (text === 'too_large') return rpcError(JSON_RPC_ERRORS.invalid, 'The message is too large.', 413);
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        return rpcError(JSON_RPC_ERRORS.parse, 'The message is not JSON.', 400);
      }
      const server = createMcpServer({
        project: auth.projectKey,
        draft: draftPort(deps, auth),
        confirmation: deps.confirmation,
      });
      const answer = await server.handle(message);
      return answer === null ? new Response(null, { status: 202 }) : json(answer);
    },

    /**
     * The human step: `{ ops, baseRevision }` as shown in the proposal; answers `{ token, expires }`.
     * It is a browser action of the builder (same-origin fetch): a request that does not say so is refused.
     * This is a speed bump, not a boundary against an assistant that holds the same admin session; a
     * separate MCP credential is the follow-up (WP-211 Notes).
     */
    async confirm(call: Request_): Promise<Response> {
      const auth = deps.authorize(call.locals.admin, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      if (call.request.headers.get('sec-fetch-site') !== 'same-origin')
        return json({ code: 'human_only', error: 'A proposal is confirmed in the builder.' }, 403);
      const text = await readCapped(call.request, MAX_MCP_BYTES);
      if (text === 'too_large') return json({ code: 'too_large', error: 'The request is too large.' }, 413);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ code: 'bad_request', error: 'The request body must be JSON.' }, 400);
      }
      const issued = await issueConfirmation(
        { project: auth.projectKey, draft: draftPort(deps, auth), confirmation: deps.confirmation },
        body,
      );
      if (issued.ok) return json({ token: issued.token, expires: issued.expires });
      return json(
        { code: issued.refusal.code, error: issued.refusal.message },
        issued.refusal.code === 'stale_revision' ? 409 : issued.refusal.code === 'invalid_input' ? 400 : 422,
      );
    },
  };
}
