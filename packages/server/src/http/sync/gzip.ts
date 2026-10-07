/** A page as a streamed, optionally gzipped JSON body: rows are written in chunks, nothing is stringified whole. */
import { PassThrough, pipeline, Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { EncodedPage, TupleTable } from '@ueberblick/core';

const ROWS_PER_CHUNK = 200;

function* table(t: TupleTable): Generator<string> {
  yield `{"columns":${JSON.stringify(t.columns)},"rows":[`;
  for (let i = 0; i < t.rows.length; i += ROWS_PER_CHUNK) {
    const chunk = t.rows.slice(i, i + ROWS_PER_CHUNK).map((r) => JSON.stringify(r));
    yield (i === 0 ? '' : ',') + chunk.join(',');
  }
  yield ']}';
}

/** The JSON text of an encoded page, in pieces. */
export function* pageJson(page: EncodedPage): Generator<string> {
  yield `{"v":${page.v},"header":${JSON.stringify(page.header)}`;
  for (const name of ['features', 'edges', 'observations', 'tombstones', 'runs', 'people'] as const) {
    yield `,"${name}":`;
    yield* table(page[name]);
  }
  yield '}';
}

export const acceptsGzip = (request: Request): boolean =>
  /\bgzip\b/i.test(request.headers.get('accept-encoding') ?? '');

/**
 * A Web stream over `source`, gzipped when asked. `pipeline` ties the stages together: a client that cancels (or a
 * stage that fails) destroys the source too, so a dropped download does not keep a generator or the compressor alive.
 */
export function streamBody(source: Readable, gzip: boolean): ReadableStream<Uint8Array> {
  const out = new PassThrough();
  const done = (): void => {
    /* an error or a cancel already destroyed every stage; there is nobody left to tell */
  };
  if (gzip) pipeline(source, createGzip(), out, done);
  else pipeline(source, out, done);
  return Readable.toWeb(out) as ReadableStream<Uint8Array>;
}

/** 200 response with the page; gzip when the caller accepts it (browsers decode it themselves). */
export function pageResponse(page: EncodedPage, gzip: boolean): Response {
  return new Response(streamBody(Readable.from(pageJson(page), { objectMode: false }), gzip), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      vary: 'accept-encoding',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    },
  });
}
