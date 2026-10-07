import { describe, expect, it, vi } from 'vitest';
import {
  archiveOfUrl,
  kindOfFile,
  removeArchive,
  layerOfResult,
  uploadFile,
  UploadFailure,
  watchJob,
  type UploadJobView,
} from './tile-upload';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const job = (over: Partial<UploadJobView> = {}): UploadJobView => ({
  id: 'u1',
  state: 'receiving',
  received: 0,
  size: 10,
  progress: { done: 0, total: 0 },
  ...over,
});

const offsetOf = (url: string): number => Number(new URL(url, 'http://x').searchParams.get('offset'));

/** A server that takes chunks in order and can drop one (a network error). */
function server(size: number, opts: { failAt?: number } = {}) {
  let received = 0;
  const calls: string[] = [];
  let failed = false;
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${u.replace(/^.*\/tiles\//, '')}`);
    if (method === 'POST' && u.endsWith('/uploads')) return json(job({ size }), 201);
    if (method === 'PUT') {
      const offset = offsetOf(u);
      if (opts.failAt === offset && !failed) {
        failed = true;
        throw new TypeError('network');
      }
      if (offset !== received)
        return json({ error: { code: 'upload_refused', reason: 'bad_chunk', received } }, 409);
      received += (init?.body as Blob).size;
      return json(job({ received }));
    }
    if (method === 'POST' && u.endsWith('/finish')) return json(job({ state: 'queued' }), 202);
    if (method === 'GET') return json(job({ received }));
    return json({}, 500);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

const file = (n: number) => new File([new Uint8Array(n)], 'a.zip');

describe('uploadFile', () => {
  it('starts, sends the chunks with their offsets, reports progress and finishes', async () => {
    const s = server(10);
    const seen: number[] = [];
    const id = await uploadFile({
      fetch: s.fetchFn,
      project: 'p',
      file: file(10),
      name: 'A',
      format: 'png',
      chunkBytes: 4,
      onProgress: (loaded) => seen.push(loaded),
      wait: async () => {},
    });
    expect(id).toBe('u1');
    expect(s.calls).toEqual([
      'POST uploads',
      'PUT uploads/u1?offset=0',
      'PUT uploads/u1?offset=4',
      'PUT uploads/u1?offset=8',
      'POST uploads/u1/finish',
    ]);
    expect(seen).toEqual([0, 4, 8, 10]);
  });

  it('resumes from the server received offset after a failed chunk', async () => {
    const s = server(10, { failAt: 4 });
    await uploadFile({
      fetch: s.fetchFn,
      project: 'p',
      file: file(10),
      name: 'A',
      chunkBytes: 4,
      wait: async () => {},
    });
    expect(s.calls).toEqual([
      'POST uploads',
      'PUT uploads/u1?offset=0',
      'PUT uploads/u1?offset=4', // dropped
      'GET uploads/u1', // received: 4
      'PUT uploads/u1?offset=4',
      'PUT uploads/u1?offset=8',
      'POST uploads/u1/finish',
    ]);
  });

  it('continues from `received` of a 409', async () => {
    let first = true;
    const puts: number[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && u.endsWith('/uploads')) return json(job({ size: 6 }), 201);
      if (init?.method === 'PUT') {
        const offset = offsetOf(u);
        puts.push(offset);
        if (first) {
          first = false;
          return json({ error: { code: 'upload_refused', reason: 'bad_chunk', received: 2 } }, 409);
        }
        return json(job({ received: offset + (init.body as Blob).size }));
      }
      return json(job({ state: 'queued' }), 202);
    });
    await uploadFile({
      fetch: fetchFn as unknown as typeof fetch,
      project: 'p',
      file: file(6),
      name: 'A',
      chunkBytes: 4,
      wait: async () => {},
    });
    expect(puts).toEqual([0, 2]);
  });

  it('names the typed reason of a refusal on start', async () => {
    const fetchFn = vi.fn(async () =>
      json({ error: { code: 'upload_refused', reason: 'too_large', message: 'x' } }, 413),
    );
    await expect(
      uploadFile({
        fetch: fetchFn as unknown as typeof fetch,
        project: 'p',
        file: file(1),
        name: 'A',
        wait: async () => {},
      }),
    ).rejects.toMatchObject({ reason: 'too_large' });
  });

  it('gives up after three failed attempts with the reason network', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return json(job({ size: 4 }), 201);
      throw new TypeError('offline');
    });
    const err = await uploadFile({
      fetch: fetchFn as unknown as typeof fetch,
      project: 'p',
      file: file(4),
      name: 'A',
      wait: async () => {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadFailure);
    expect((err as UploadFailure).reason).toBe('network');
  });
});

describe('watchJob', () => {
  it('polls until done, passing every state on, and retries after a network error', async () => {
    const answers: Array<() => Response> = [
      () => json(job({ state: 'queued' })),
      () => {
        throw new TypeError('offline');
      },
      () => json(job({ state: 'processing', progress: { done: 1, total: 4 } })),
      () => json(job({ state: 'done' })),
    ];
    const fetchFn = vi.fn(async () => (answers.shift() ?? (() => json({}, 500)))());
    const states: string[] = [];
    const final = await watchJob({
      fetch: fetchFn as unknown as typeof fetch,
      project: 'p',
      id: 'u1',
      onJob: (j) => states.push(j.state),
      wait: async () => {},
    });
    expect(final.state).toBe('done');
    expect(states).toEqual(['queued', 'processing', 'done']);
  });
});

describe('helpers', () => {
  it('kindOfFile reads the extension', () => {
    expect(kindOfFile('Luft.ZIP')).toBe('zip');
    expect(kindOfFile('a.mbtiles')).toBe('mbtiles');
    expect(kindOfFile('a.pmtiles')).toBe('pmtiles');
    expect(kindOfFile('a.txt')).toBeNull();
  });

  it('layerOfResult builds a pmtiles overlay with the archive url and zooms; vector archives are left to the PMTiles tab', () => {
    const result = {
      url: '/api/p/p/tiles/archives/ab12.pmtiles',
      archive: 'ab12',
      format: 'png' as const,
      bounds: [0, 0, 1, 1] as const,
      minZoom: 2,
      maxZoom: 14,
    };
    expect(layerOfResult('Luftbild', result)).toEqual({
      label: 'Luftbild',
      kind: 'overlay',
      source: { type: 'pmtiles', url: result.url, tile_type: 'raster' },
      minzoom: 2,
      maxzoom: 14,
    });
    expect(layerOfResult('Vektor', { ...result, format: 'pbf' })).toBeNull();
  });

  it('archiveOfUrl finds the archive of an uploaded layer', () => {
    expect(archiveOfUrl('/api/p/stadt/tiles/archives/ab12.pmtiles')).toBe('ab12');
    expect(archiveOfUrl('https://x.org/a.pmtiles')).toBeNull();
  });
});

describe('removeArchive', () => {
  it('is done on 204 and names the referencing keys on 409', async () => {
    const ok = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await removeArchive(ok as unknown as typeof fetch, 'p', 'ab12')).toEqual({ ok: true });
    expect(ok.mock.calls[0]).toEqual(['/api/admin/projects/p/tiles/ab12', { method: 'DELETE' }]);
    const used = vi.fn(async () =>
      json({ error: { code: 'conflict', references: ['luftbild', 'paket (Entwurf)'] } }, 409),
    );
    expect(await removeArchive(used as unknown as typeof fetch, 'p', 'ab12')).toEqual({
      ok: false,
      references: ['luftbild', 'paket (Entwurf)'],
    });
  });
});
