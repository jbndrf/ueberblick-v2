import { describe, expect, it } from 'vitest';
import type { LayoutNode, Principal } from '@ueberblick/server';
import { createLayoutHandlers, MAX_LAYOUT_BYTES, type LayoutDeps } from './builder-layout';

const admin = { kind: 'admin', id: 'admin-1' } as unknown as Principal;

/** An in-memory store keyed by project and type, with the same replace rule as the real one. */
function fakes(deny?: Response) {
  const store = new Map<string, readonly LayoutNode[]>();
  const calls: string[] = [];
  const deps: LayoutDeps = {
    authorize: (principal, project) => deny ?? { projectKey: project, principal: principal as Principal },
    get: (project, type) => store.get(`${project}/${type}`) ?? [],
    replace: (project, type, nodes, by) => {
      calls.push(`${project}/${type}:${by}`);
      store.set(`${project}/${type}`, nodes);
    },
  };
  return { deps, calls };
}
type H = ReturnType<typeof createLayoutHandlers>;
const get = (h: H, project = 'muster', query = '?type=baum') =>
  h.GET({ params: { project }, locals: { admin: admin }, url: new URL(`http://x/layout${query}`) });
const put = (h: H, body: unknown, project = 'muster') =>
  h.PUT({
    params: { project },
    locals: { admin: admin },
    request: new Request('http://x/layout', {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  });
const nodes = [
  { id: 'stage:erfasst', x: 10, y: 20.5 },
  { id: 'global', x: -300, y: 0 },
];

describe('/builder-api/<project>/layout', () => {
  it('refuses with the admin check unchanged (401/403/404) on both verbs', async () => {
    const h = createLayoutHandlers(fakes(new Response('no', { status: 401 })).deps);
    expect(get(h).status).toBe(401);
    expect((await put(h, { type: 'baum', nodes })).status).toBe(401);
  });

  it('a PUT then a GET round-trips the positions, as the calling admin', async () => {
    const f = fakes();
    const h = createLayoutHandlers(f.deps);
    expect((await put(h, { type: 'baum', nodes })).status).toBe(200);
    expect(f.calls).toEqual(['muster/baum:admin-1']);
    expect(await get(h).json()).toEqual({ type: 'baum', nodes });
  });

  it('is scoped to the project and the type', async () => {
    const h = createLayoutHandlers(fakes().deps);
    await put(h, { type: 'baum', nodes });
    expect(await get(h, 'andere').json()).toEqual({ type: 'baum', nodes: [] });
    expect(await get(h, 'muster', '?type=flaeche').json()).toEqual({ type: 'flaeche', nodes: [] });
  });

  it('a GET without a type is a 400', () => {
    expect(get(createLayoutHandlers(fakes().deps), 'muster', '').status).toBe(400);
  });

  it('refuses malformed bodies with 400 and stores nothing', async () => {
    const f = fakes();
    const h = createLayoutHandlers(f.deps);
    const bad: unknown[] = [
      'not json',
      { nodes },
      { type: 'baum' },
      { type: 'baum', nodes: [{ id: 'a', x: '1', y: 2 }] },
      { type: 'baum', nodes: [{ id: '', x: 1, y: 2 }] },
      {
        type: 'baum',
        nodes: [
          { id: 'a', x: 1, y: 2 },
          { id: 'a', x: 3, y: 4 },
        ],
      },
      '{"type":"baum","nodes":[{"id":"a","x":1e999,"y":2}]}',
    ];
    for (const body of bad) expect((await put(h, body)).status).toBe(400);
    expect(f.calls).toEqual([]);
  });

  it('caps the node count (400) and the body size (413)', async () => {
    const h = createLayoutHandlers(fakes().deps);
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `stage:${i}`, x: i, y: i }));
    expect((await put(h, { type: 'baum', nodes: many })).status).toBe(400);
    const huge = { type: 'baum', nodes: [{ id: 'a'.repeat(MAX_LAYOUT_BYTES), x: 0, y: 0 }] };
    expect((await put(h, huge)).status).toBe(413);
  });

  it('an empty list clears the type', async () => {
    const h = createLayoutHandlers(fakes().deps);
    await put(h, { type: 'baum', nodes });
    await put(h, { type: 'baum', nodes: [] });
    expect(await get(h).json()).toEqual({ type: 'baum', nodes: [] });
  });
});
