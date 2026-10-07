/**
 * The single `$ref` walker (R1, WP-577 review 1): ingestion replaces every `{ $ref: string }` object by the bundle
 * file it names. One walk for the golden corpus (core `testing`), the e2e and the demo (`scripts/embed-refs.mjs`).
 * No imports and erasable TypeScript only, so Node 22's built-in type stripping loads this file directly.
 */

/** Looks up one bundle file by the path a `$ref` names; `undefined` when the bundle does not hold it. */
export type RefResolver = (ref: string) => unknown;

/** The resolved JSON without its top-level `$comment` key: the bundle files carry one, and it is not part of the value. */
const withoutComment = (json: unknown): unknown => {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return json;
  const rec = json as Record<string, unknown>;
  if (!('$comment' in rec)) return json;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) if (k !== '$comment') out[k] = v;
  return out;
};

/**
 * `value` with every `{ $ref: string }` object replaced by `resolve(ref)`; a `$comment` key of the resolved JSON is
 * dropped. Throws when `resolve` returns undefined. Shares every unchanged subtree and returns `value` itself when
 * it holds no `$ref`; the input is never mutated.
 */
export function embedRefs<T>(value: T, resolve: RefResolver): T {
  const walk = (v: unknown): unknown => {
    if (typeof v !== 'object' || v === null) return v;
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const n = walk(x);
        if (n !== x) changed = true;
        return n;
      });
      return changed ? out : v;
    }
    const rec = v as Record<string, unknown>;
    if (typeof rec.$ref === 'string') {
      const json = resolve(rec.$ref);
      if (json === undefined) throw new Error(`unresolved $ref: ${rec.$ref}`);
      // A bundle file that is text is an SVG icon (B-018): `{ $ref, size? }` becomes `{ svg, size? }`.
      if (typeof json === 'string') {
        const out: Record<string, unknown> = { svg: json };
        for (const [k, x] of Object.entries(rec)) if (k !== '$ref') out[k] = x;
        return out;
      }
      return withoutComment(json);
    }
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(rec)) {
      const n = walk(x);
      if (n !== x) changed = true;
      out[k] = n;
    }
    return changed ? out : v;
  };
  return walk(value) as T;
}
