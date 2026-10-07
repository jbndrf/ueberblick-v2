import { describe, expect, it } from 'vitest';
import { COMPILED_FORMAT, CompiledConfigError } from '@ueberblick/core/hydrate';
import { SYNC_PROTOCOL_VERSION } from '@ueberblick/core/sync';
import type { FetchLike } from './http';
import { createBlobTransport, createConfigFetcher, createRunTransport } from './transports';

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function recorder(answer: (url: string, init?: RequestInit) => Response | Error) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const r = answer(url, init);
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, fetch };
}

describe('run transport', () => {
  const wire = { id: 'r1', task: 't', configVersion: 1, input: {} };
  const accepted = { v: SYNC_PROTOCOL_VERSION, outcome: 'accepted', runId: 'r1', seq: { from: 1, to: 1 } };

  it('posts a run to /runs and a batch to /runs/batch and decodes only the typed envelope', async () => {
    const r = recorder(() => reply(200, accepted));
    const transport = createRunTransport('demo', r.fetch);
    expect(await transport.send({ kind: 'run', run: wire })).toMatchObject({ kind: 'response' });
    await transport.send({ kind: 'batch', runs: [wire] });
    expect(r.calls.map((c) => c.url)).toEqual(['/api/p/demo/runs', '/api/p/demo/runs/batch']);
    expect(JSON.parse(String(r.calls[1]?.init?.body))).toEqual({ runs: [wire] });
  });

  it('a network error is transient, a 401 is unauthenticated, a proxy 502 is transient, a wrong v is incompatible', async () => {
    const send = (a: () => Response | Error) =>
      createRunTransport('demo', recorder(a).fetch).send({ kind: 'run', run: wire });
    expect((await send(() => new Error('offline'))).kind).toBe('transient');
    expect((await send(() => reply(401, { error: {} }))).kind).toBe('unauthenticated');
    expect((await send(() => reply(502, 'Bad gateway'))).kind).toBe('transient');
    expect(await send(() => reply(200, { ...accepted, v: 99 }))).toEqual({ kind: 'incompatible', v: 99 });
  });
});

describe('config fetcher', () => {
  it('fetches the compiled form of a version', async () => {
    const data = { format: COMPILED_FORMAT, file: {}, hash: 'h', expressions: [] };
    const r = recorder(() => reply(200, data));
    expect(await createConfigFetcher('demo', r.fetch).fetchCompiled(3)).toEqual(data);
    expect(r.calls[0]?.url).toBe('/participant-api/demo/config/3');
    await expect(
      createConfigFetcher('demo', recorder(() => reply(404, {})).fetch).fetchCompiled(3),
    ).rejects.toThrow(/404/);
  });

  it('refuses loudly a payload of the wrong shape or another stored format, instead of casting it', async () => {
    const fetchWith = (body: unknown) =>
      createConfigFetcher('demo', recorder(() => reply(200, body)).fetch).fetchCompiled(3);
    await expect(fetchWith({ format: 1 })).rejects.toThrow(/malformed/);
    await expect(fetchWith('nope')).rejects.toThrow(/malformed/);
    await expect(
      fetchWith({ format: COMPILED_FORMAT + 1, file: {}, hash: 'h', expressions: [] }),
    ).rejects.toBeInstanceOf(CompiledConfigError);
  });
});

describe('blob transport', () => {
  const sha = 'a'.repeat(64);
  const bytes = new Uint8Array([1, 2, 3]);

  it('HEAD says whether the server has the file; other statuses throw', async () => {
    const answer = (s: number) => createBlobTransport('demo', recorder(() => reply(s, '')).fetch);
    expect(await answer(200).has(sha)).toBe(true);
    expect(await answer(404).has(sha)).toBe(false);
    await expect(answer(500).has(sha)).rejects.toThrow();
  });

  it('PUT sends the bytes with their mime to the blob route', async () => {
    const r = recorder(() => reply(201, ''));
    expect(await createBlobTransport('demo', r.fetch).put(sha, bytes, 'image/jpeg')).toBe('ok');
    expect(r.calls[0]?.url).toBe(`/api/p/demo/blobs/${sha}`);
    expect(r.calls[0]?.init?.method).toBe('PUT');
    expect(r.calls[0]?.init?.headers).toEqual({ 'content-type': 'image/jpeg' });
    expect(new Uint8Array(await (r.calls[0]?.init?.body as Blob).arrayBuffer())).toEqual(bytes);
  });

  it('maps 200 to ok, 409 to mismatch, 413 to too_large; 401, 5xx and a network error throw', async () => {
    const put = (a: () => Response | Error) =>
      createBlobTransport('demo', recorder(a).fetch).put(sha, bytes, 'image/png');
    expect(await put(() => reply(200, ''))).toBe('ok');
    expect(await put(() => reply(409, ''))).toBe('mismatch');
    expect(await put(() => reply(413, ''))).toBe('too_large');
    await expect(put(() => reply(401, ''))).rejects.toThrow();
    await expect(put(() => reply(503, ''))).rejects.toThrow();
    await expect(put(() => new Error('offline'))).rejects.toThrow('offline');
  });
});
