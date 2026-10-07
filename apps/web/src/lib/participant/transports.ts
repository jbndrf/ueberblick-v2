/**
 * The device's transports for runs and config versions (sync pages: `sync-transport.ts`, which also runs in the sync worker). Every reply is judged by the typed
 * decoders of `@ueberblick/client` / `core/sync`; a status code alone never decides anything (v3 lesson 5).
 * Part of the lazy device chunk.
 */
import {
  decodeRunReply,
  type BlobTransport,
  type ConfigFetcher,
  type RunPayload,
  type RunTransport,
} from '@ueberblick/client';
import { hydrate } from '@ueberblick/core/hydrate';
import { decodeCompiled } from './decode';
import { json, type FetchLike } from './http';

/** Run endpoints: `POST /runs` for one run, `POST /runs/batch` for an atomic batch. */
export function createRunTransport(project: string, fetch: FetchLike): RunTransport {
  return {
    async send(payload: RunPayload) {
      const single = payload.kind === 'run';
      let res: Response;
      try {
        res = await fetch(`/api/p/${project}/runs${single ? '' : '/batch'}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(single ? payload.run : { runs: payload.runs }),
        });
      } catch (e) {
        return { kind: 'transient', reason: e instanceof Error ? e.message : 'network error' };
      }
      return decodeRunReply(res.status, await json(res));
    },
  };
}

/**
 * File bytes before the run (WP-604 routes): `HEAD` asks whether the server has them, `PUT` sends them with their
 * MIME type, one file at a time. 409 and 413 are the typed answers; anything else that is not a success throws,
 * which the queue treats as transient.
 */
export function createBlobTransport(project: string, fetch: FetchLike): BlobTransport {
  const url = (sha256: string) => `/api/p/${project}/blobs/${sha256}`;
  return {
    async has(sha256) {
      const res = await fetch(url(sha256), { method: 'HEAD' });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      throw new Error(`blob ${sha256}: status ${res.status}`);
    },
    async put(sha256, bytes, mime) {
      const res = await fetch(url(sha256), {
        method: 'PUT',
        headers: { 'content-type': mime },
        body: new Blob([new Uint8Array(bytes)]),
      });
      if (res.status === 200 || res.status === 201) return 'ok';
      if (res.status === 409) return 'mismatch';
      if (res.status === 413) return 'too_large';
      throw new Error(`blob ${sha256}: status ${res.status}`);
    },
  };
}

export function createConfigFetcher(project: string, fetch: FetchLike): ConfigFetcher {
  return {
    async fetchCompiled(version) {
      const res = await fetch(`/participant-api/${project}/config/${version}`);
      if (!res.ok) throw new Error(`config version ${version}: status ${res.status}`);
      const data = decodeCompiled(await json(res));
      hydrate(data); // validates the format and the types; throws CompiledConfigError on a mismatch
      return data;
    },
  };
}
