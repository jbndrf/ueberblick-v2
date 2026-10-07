import { describe, expect, it, vi } from 'vitest';
import { createLayoutClient } from './layout-client';

describe('createLayoutClient', () => {
  it('loads the positions of a type from the project route', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ type: 'baum', nodes: [{ id: 'global', x: 1, y: 2 }] })),
    );
    const api = createLayoutClient({ project: 'muster', fetch });
    expect(await api.load('baum')).toEqual([{ id: 'global', x: 1, y: 2 }]);
    expect(fetch).toHaveBeenCalledWith('/builder-api/muster/layout?type=baum');
  });

  it('saves with one PUT of { type, nodes }', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    await createLayoutClient({ project: 'muster', fetch }).save('baum', [{ id: 'global', x: 1, y: 2 }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/builder-api/muster/layout');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ type: 'baum', nodes: [{ id: 'global', x: 1, y: 2 }] });
  });

  it('throws on a refusal, so the saver can drop it and the canvas can fall back', async () => {
    const api = createLayoutClient({ project: 'm', fetch: async () => new Response('no', { status: 403 }) });
    await expect(api.load('baum')).rejects.toThrow('403');
    await expect(api.save('baum', [])).rejects.toThrow('403');
  });
});
