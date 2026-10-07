/**
 * The one text of "an edge counts only if its far end is a live feature" (a feature that was created and is not
 * deleted). `relationFrom`/`through` in `values.ts` (rule language relations) and the server's `Facts.edgesFrom`,
 * `edgesTo` and `related` all build on it (R1). Pure strings: aliases are chosen by the caller, values are never
 * pasted in.
 */
import { servedSql } from '../../registry/lifecycle';

/** `out` follows an edge from its `from_id` to its far end `to_id`; `in` goes the other way. */
export type EdgeDirection = 'out' | 'in';

export interface LiveEdgeJoin {
  /** `JOIN features <feature> ON <feature>.id = <edge>.<far>`. */
  readonly join: string;
  /** The liveness condition, to be ANDed into the `WHERE`: `<feature>.lifecycle IN ('active','completed')` (`servedSql`). */
  readonly live: string;
  /** The edge column that holds the known (near) feature id, for `WHERE <edge>.<near> = ?`. */
  readonly near: 'from_id' | 'to_id';
  /** The edge column that holds the far end. */
  readonly far: 'from_id' | 'to_id';
}

const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

function alias(role: string, v: string): string {
  if (!ALIAS.test(v)) throw new Error(`liveEdgeJoin: ${role} alias '${v}' is not a plain SQL identifier`);
  return v;
}

export function liveEdgeJoin(o: {
  readonly edge: string;
  readonly feature: string;
  readonly direction: EdgeDirection;
}): LiveEdgeJoin {
  const edge = alias('edge', o.edge);
  const feature = alias('feature', o.feature);
  const [near, far] =
    o.direction === 'out' ? (['from_id', 'to_id'] as const) : (['to_id', 'from_id'] as const);
  return {
    join: `JOIN features ${feature} ON ${feature}.id = ${edge}.${far}`,
    live: servedSql(`${feature}.lifecycle`),
    near,
    far,
  };
}
