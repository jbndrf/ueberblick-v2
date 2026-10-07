/**
 * The one text of "features inside a viewport" (WP-590). The R*Tree `feature_bbox` should drive the query:
 * a viewport is a small slice of the project, while an expression index (`cfg_idx_*`, server deploy) on a
 * filter that matches most rows lures the planner into walking the index and probing the R*Tree once per match
 * (72 ms against 24 ms at 60k features). `CROSS JOIN` fixes the join order in SQLite, so the R*Tree is scanned
 * first and `features` is fetched by rowid. Filters keep their result: only the order changes. Pure strings;
 * aliases are chosen by the caller and values are never pasted in.
 */
import type { Bbox } from '../../geo/contract';

export interface ViewportFrom {
  /** `FROM feature_bbox <box> CROSS JOIN features <feature> ON <feature>.rowid = <box>.rid`. */
  readonly from: string;
  /** The intersection condition, to be ANDed into the `WHERE`; its four `?` take `args(bbox)`. */
  readonly near: string;
  /** The bound values for `near`, in order, for a bbox `[west, south, east, north]`. */
  readonly args: (bbox: Bbox) => readonly [number, number, number, number];
}

const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

function alias(role: string, v: string): string {
  if (!ALIAS.test(v)) throw new Error(`viewportFrom: ${role} alias '${v}' is not a plain SQL identifier`);
  return v;
}

function parts(o: { readonly feature: string; readonly box: string }): {
  f: string;
  b: string;
  near: string;
  args: ViewportFrom['args'];
} {
  const f = alias('feature', o.feature);
  const b = alias('box', o.box);
  return {
    f,
    b,
    near: `${b}.minx <= ? AND ${b}.maxx >= ? AND ${b}.miny <= ? AND ${b}.maxy >= ?`,
    args: (bbox) => [bbox[2], bbox[0], bbox[3], bbox[1]],
  };
}

export function viewportFrom(o: { readonly feature: string; readonly box: string }): ViewportFrom {
  const { f, b, near, args } = parts(o);
  return { from: `FROM feature_bbox ${b} CROSS JOIN features ${f} ON ${f}.rowid = ${b}.rid`, near, args };
}

/**
 * The same rows as `viewportFrom`, for keyset paging (`<feature>.rowid > ? ORDER BY <feature>.rowid LIMIT n`).
 * A plain `JOIN` leaves the join order to SQLite, which can then walk `features` in rowid order, probe the
 * R*Tree per row and stop at the `LIMIT`. Over a wide viewport (a whole layer read page by page by a GIS client)
 * that costs a page; `viewportFrom` would collect and sort every match first (about 50 ms per page at 60k).
 * Over a narrow viewport `viewportFrom` is faster, because the R*Tree returns few rows. Use this helper only for
 * a rowid-ordered, limited read; every other viewport read uses `viewportFrom` (WP-591).
 */
export function viewportPageFrom(o: { readonly feature: string; readonly box: string }): ViewportFrom {
  const { f, b, near, args } = parts(o);
  return { from: `FROM features ${f} JOIN feature_bbox ${b} ON ${b}.rid = ${f}.rowid`, near, args };
}
