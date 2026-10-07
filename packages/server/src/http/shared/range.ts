/**
 * The `Range` request header of a static file (RFC 9110 §14): one range of bytes, as `a-b`, `a-` or `-n`. A header that
 * is absent, malformed, names another unit or asks for several ranges is ignored, so the whole file answers with 200
 * (allowed by the RFC). A range that starts past the end is unsatisfiable (416).
 */
export type ByteRange =
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' };

const ONE_RANGE = /^bytes=(\d*)-(\d*)$/;

/** `end` is inclusive, as in `Content-Range`. */
export function parseByteRange(header: string | null, size: number): ByteRange {
  if (header === null) return { kind: 'full' };
  const m = ONE_RANGE.exec(header.trim());
  if (m === null) return { kind: 'full' };
  const [, from = '', to = ''] = m;
  if (from === '' && to === '') return { kind: 'full' };
  if (from === '') {
    const n = Number(to); // suffix: the last n bytes
    if (n === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Number(to);
  if (to !== '' && end < start) return { kind: 'full' }; // an invalid range is ignored
  if (start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end: Math.min(end, size - 1) };
}
