import { MAX_LAYOUT_NODES, type LayoutNode, type Principal } from '@ueberblick/server';
import { readCapped } from './builder-draft';
import { isRecord, json, type Call } from './http';

/** A body of 500 nodes with long ids is about 60 KB; this is far above any real one. */
export const MAX_LAYOUT_BYTES = 100_000;
const MAX_ID = 200;

export interface LayoutDeps {
  /** The admin behind the call, or the refusing response (401/403/404). */
  authorize(
    principal: Principal | null,
    project: string,
  ): { readonly projectKey: string; readonly principal: Principal } | Response;
  get(project: string, type: string): readonly LayoutNode[];
  replace(project: string, type: string, nodes: readonly LayoutNode[], by: string): void;
}

const key = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID;

function parseNodes(value: unknown): readonly LayoutNode[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LAYOUT_NODES) return undefined;
  const out: LayoutNode[] = [];
  const seen = new Set<string>();
  for (const n of value as unknown[]) {
    if (!isRecord(n) || !key(n['id']) || seen.has(n['id'])) return undefined;
    const { x, y } = n;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
      return undefined;
    seen.add(n['id']);
    out.push({ id: n['id'], x, y });
  }
  return out;
}

/**
 * `GET`/`PUT /builder-api/<project>/layout` (WP-366, E-21): where the admin dragged the nodes of a type's canvas.
 * Not part of the draft or any config version. A `PUT` makes its nodes the stored set of the type, so the
 * positions of nodes that no longer exist are pruned by the save that omits them.
 */
export function createLayoutHandlers(deps: LayoutDeps) {
  return {
    GET(call: Pick<Call, 'params' | 'locals'> & { url: URL }): Response {
      const auth = deps.authorize(call.locals.admin, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const type = call.url.searchParams.get('type');
      if (!key(type)) return json({ code: 'bad_request', error: 'Send ?type=<feature type>.' }, 400);
      return json({ type, nodes: deps.get(auth.projectKey, type) });
    },

    async PUT(call: Pick<Call, 'params' | 'locals' | 'request'>): Promise<Response> {
      const auth = deps.authorize(call.locals.admin, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const text = await readCapped(call.request, MAX_LAYOUT_BYTES);
      if (text === 'too_large') return json({ code: 'too_large', error: 'The layout is too large.' }, 413);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return json({ code: 'bad_request', error: 'The request body must be JSON.' }, 400);
      }
      const nodes = isRecord(value) ? parseNodes(value['nodes']) : undefined;
      if (!isRecord(value) || !key(value['type']) || nodes === undefined)
        return json(
          {
            code: 'bad_request',
            error: 'Send { "type": key, "nodes": [{ "id", "x", "y" }] } (at most 500 nodes).',
          },
          400,
        );
      deps.replace(auth.projectKey, value['type'], nodes, auth.principal.id);
      return json({ type: value['type'], nodes });
    },
  };
}
