// The browser's PackTransport: `fetch` against `/api/p/<project>/packs` (A-032 items 3 and 4).
import { decodePackManifest } from '@ueberblick/core/sync';
import type { PackTransport } from './contract';

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal | undefined },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
}>;

async function* read(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const r = body.getReader();
  try {
    for (;;) {
      const { done, value } = await r.read();
      if (done) return;
      yield value;
    }
  } finally {
    r.releaseLock();
  }
}

export function fetchPackTransport(project: string, fetchFn: FetchLike): PackTransport {
  return {
    async manifest(signal) {
      const res = await fetchFn(`/api/p/${encodeURIComponent(project)}/packs`, { signal });
      if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
      const decoded = decodePackManifest(await res.json());
      if (!decoded.ok) throw new Error(`manifest: ${decoded.reason}`);
      return decoded.manifest;
    },
    async download(url, from, signal) {
      const res = await fetchFn(url, { headers: from > 0 ? { Range: `bytes=${from}-` } : {}, signal });
      if (res.status !== 200 && res.status !== 206) throw new Error(`download: HTTP ${res.status}`);
      if (res.body === null) throw new Error('download: no body');
      return { partial: res.status === 206, chunks: read(res.body) };
    },
  };
}
