import type { Draft, EnsureResult, PutResult, Principal } from '@ueberblick/server';
import { isRecord, json, type Call } from './http';

/** A request body is an overlay (a text file edited by hand) in JSON; a megabyte is far above any real one. */
export const MAX_OVERLAY_BYTES = 1_000_000;

/**
 * The body as text, read with a byte cap: `Content-Length` is checked first, and the stream is
 * cancelled as soon as it passes the cap, so an oversized body is never buffered or parsed.
 */
export async function readCapped(request: Request, max: number): Promise<string | 'too_large'> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return 'too_large';
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return 'too_large';
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** What the handlers need from the app; the route wires the real ones (tests pass fakes). */
export interface DraftDeps {
  /** The admin behind the call, or the refusing response (401/403/404). */
  authorize(
    principal: Principal | null,
    project: string,
  ): { readonly projectKey: string; readonly principal: Principal } | Response;
  /** The project's draft; the first call creates it from the deployed version. */
  ensure(project: string, by: string): EnsureResult;
  /** Compare-and-swap write of the overlay. */
  put(project: string, expected: number, overlay: string, by: string): PutResult;
}

const view = (d: Draft) => ({
  template: d.template,
  templateVersion: d.templateVersion,
  overlay: d.overlay,
  revision: d.revision,
  updatedBy: d.updatedBy,
  updatedAt: d.updatedAt,
});

/**
 * `GET`/`PUT /builder-api/<project>/draft` (A-011): the one working draft of a project. The builder,
 * assistants and the MCP server (H4) use these two and get the same 409.
 */
export function createDraftHandlers(deps: DraftDeps) {
  return {
    GET(call: Pick<Call, 'params' | 'locals'>): Response {
      const auth = deps.authorize(call.locals.admin, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const r = deps.ensure(auth.projectKey, auth.principal.id);
      if (!r.ok)
        return json({ code: r.code, error: 'No version is deployed, so there is nothing to edit yet.' }, 404);
      return json(view(r.draft));
    },

    async PUT(call: Pick<Call, 'params' | 'locals' | 'request'>): Promise<Response> {
      const auth = deps.authorize(call.locals.admin, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const text = await readCapped(call.request, MAX_OVERLAY_BYTES);
      if (text === 'too_large') return json({ code: 'too_large', error: 'The overlay is too large.' }, 413);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return json({ code: 'bad_request', error: 'The request body must be JSON.' }, 400);
      }
      if (!isRecord(value) || typeof value['overlay'] !== 'string' || !Number.isInteger(value['revision']))
        return json({ code: 'bad_request', error: 'Send { "overlay": text, "revision": integer }.' }, 400);
      const overlay = value['overlay'];
      const r = deps.put(auth.projectKey, value['revision'] as number, overlay, auth.principal.id);
      if (r.ok) return json({ revision: r.draft.revision });
      if (r.draft === undefined)
        return json({ code: 'no_draft', error: 'There is no draft yet; read it first.' }, 404);
      return json({ code: 'stale_revision', draft: view(r.draft) }, 409);
    },
  };
}
