// The browser's ThumbTransport: the server's own `?thumb=<size>` route (WP-618), the one the photo URL falls back to.
import { CACHED_THUMB_SIZE, type ThumbTransport } from './contract';

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal | undefined },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function fetchThumbTransport(project: string, fetchFn: FetchLike): ThumbTransport {
  return {
    async fetch(sha256, signal) {
      const url = `/api/p/${encodeURIComponent(project)}/blobs/${sha256}?thumb=${CACHED_THUMB_SIZE}`;
      const res = await fetchFn(url, { signal });
      // 404/403: no thumbnail for this photo (not an image, no access): not an error of the connection
      if (res.status === 404 || res.status === 403) return undefined;
      if (!res.ok) throw new Error(`thumbnail: HTTP ${String(res.status)}`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        mime: res.headers.get('content-type') ?? 'image/webp',
      };
    },
  };
}
