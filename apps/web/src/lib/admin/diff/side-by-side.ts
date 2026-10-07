/**
 * Side-by-side rows for the compare view (WP-1056): the rows `collapse` returns (from the one line diff, R1) are paired so
 * live sits left and draft right. A run of removed lines followed by a run of added lines becomes changed rows (one removed
 * and one added line on the same row); leftovers of the longer run pair with an empty cell. Unchanged lines span both sides.
 */
import { DIFF_OP, type DiffRow, type LineOp } from './line-diff';

export type SideRow =
  | { readonly kind: 'equal'; readonly key: string; readonly line: LineOp }
  | {
      readonly kind: 'pair';
      readonly key: string;
      readonly left: LineOp | null;
      readonly right: LineOp | null;
    }
  | { readonly kind: 'folded'; readonly key: string; readonly count: number; readonly from: number };

/** Pairs the rows; a folded row whose `from` is in `expanded` is replaced by its unchanged lines. */
export function pairRows(
  rows: readonly DiffRow[],
  ops: readonly LineOp[],
  expanded: ReadonlySet<number> = new Set(),
): readonly SideRow[] {
  const flat: DiffRow[] = [];
  for (const r of rows) {
    if (r.kind === 'folded' && expanded.has(r.from)) {
      for (let k = r.from; k < r.from + r.count; k++)
        flat.push({ kind: 'line', op: ops[k] as LineOp, index: k });
    } else flat.push(r);
  }
  const out: SideRow[] = [];
  let removed: { op: LineOp; index: number }[] = [];
  let added: { op: LineOp; index: number }[] = [];
  const flush = (): void => {
    const n = Math.max(removed.length, added.length);
    for (let i = 0; i < n; i++) {
      const l = removed[i];
      const r = added[i];
      out.push({
        kind: 'pair',
        key: `p${(l ?? r)?.index ?? i}-${r?.index ?? 'x'}`,
        left: l?.op ?? null,
        right: r?.op ?? null,
      });
    }
    removed = [];
    added = [];
  };
  for (const r of flat) {
    if (r.kind === 'folded') {
      flush();
      out.push({ kind: 'folded', key: `f${r.from}`, count: r.count, from: r.from });
    } else if (r.op.op === DIFF_OP.remove) {
      // a remove after an add starts a new change block
      if (added.length > 0) flush();
      removed.push({ op: r.op, index: r.index });
    } else if (r.op.op === DIFF_OP.add) added.push({ op: r.op, index: r.index });
    else {
      flush();
      out.push({ kind: 'equal', key: `e${r.index}`, line: r.op });
    }
  }
  flush();
  return out;
}
