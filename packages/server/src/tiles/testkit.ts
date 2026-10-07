/** Test support for the tile proxy: a fake upstream (the `fetch` port) and a service over a temp directory. */
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchRange } from '../packs/fetch';
import { createTileService, type TileService, type TileServiceDeps } from './service';

/** The 8 bytes every PNG starts with, then the text: readable in a failing test and recognised by the sniffer. */
export const png = (text: string): Uint8Array =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(text)]);

export type Answer = Response | Promise<Response>;

export interface FakeUpstream {
  readonly fetch: typeof fetch;
  /** Every request made: its URL and User-Agent. */
  readonly calls: { url: string; userAgent: string | null }[];
}

/** A `fetch` that answers from `answers(url)`; no answer is a 404. */
export function fakeUpstream(answers: (url: string) => Answer | undefined): FakeUpstream {
  const calls: FakeUpstream['calls'] = [];
  return {
    calls,
    fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      const ua = new Headers(init?.headers).get('user-agent');
      calls.push({ url, userAgent: ua });
      const a = answers(url);
      if (a === undefined) return new Response(null, { status: 404 });
      return (await a).clone();
    }) as typeof fetch,
  };
}

export const ok = (bytes: Uint8Array, headers: Record<string, string> = {}): Response =>
  new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': 'image/png', ...headers } });

export const noRange: FetchRange = async () => {
  throw new Error('no range source in this test');
};

export interface Kit {
  readonly root: string;
  readonly service: TileService;
}

/** A service with no waiting (`sleep` resolves at once) over a fresh directory. */
export function kit(upstream: FakeUpstream, over: Partial<TileServiceDeps> = {}): Kit {
  const root = mkdtempSync(join(tmpdir(), 'tiles-'));
  const service = createTileService({
    root,
    fetch: upstream.fetch,
    fetchRange: noRange,
    userAgent: 'Überblick/4 (+https://test.example)',
    sleep: async () => undefined,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }], // every test host is public
    ...over,
  });
  return { root, service };
}

/** The files under `root`, as paths relative to it (a walk of a temp directory the test owns). */
export const filesUnder = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => `${e.parentPath.slice(root.length + 1)}/${e.name}`.replace(/^\//, ''));
