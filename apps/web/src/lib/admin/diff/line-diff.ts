/**
 * A line diff of two texts (WP-506, "Projektdatei vergleichen"): Myers' O(ND) algorithm after the common head and tail are
 * trimmed, so a 5000-line project file with a few edits costs a few milliseconds. Written once here (R1); no dependency.
 * `collapse` folds long unchanged runs so a large file stays responsive: only the changes with a few lines of context
 * are rendered, the rest is a "n unveränderte Zeilen" row.
 */
export const DIFF_OP = { equal: 'equal', add: 'add', remove: 'remove' } as const;
export type DiffOpKind = (typeof DIFF_OP)[keyof typeof DIFF_OP];

/** One line of the diff. `oldLine` / `newLine` are 1-based; `null` where the line does not exist on that side. */
export interface LineOp {
  readonly op: DiffOpKind;
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

/** Beyond this many edits the minimal script is not worth its memory: the middle becomes "all removed, all added". */
const MAX_EDITS = 3000;

/** The lines of a text; the final newline does not start a line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

type Edit = { readonly op: 'equal' | 'add' | 'remove'; readonly ai: number; readonly bi: number };

/** The edit script of `a` to `b` (indices into the trimmed middle), or `null` when it needs more than `MAX_EDITS` edits. */
function myers(a: readonly string[], b: readonly string[]): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  // Walk back through the trace: `trace[d]` is V before round d, stored for k in [-d-1, d+1].
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d] as Int32Array;
    const at = (k: number): number => prev[k + d + 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    while (x > (down ? px : px + 1) && y > (down ? py + 1 : py)) {
      x--;
      y--;
      edits.push({ op: 'equal', ai: x, bi: y });
    }
    if (down) {
      y--;
      edits.push({ op: 'add', ai: x, bi: y });
    } else {
      x--;
      edits.push({ op: 'remove', ai: x, bi: y });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    edits.push({ op: 'equal', ai: x, bi: y });
  }
  return edits.reverse();
}

/** The diff of two line lists: every old line is an `equal` or a `remove`, every new line an `equal` or an `add`. */
export function lineDiff(a: readonly string[], b: readonly string[]): readonly LineOp[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const out: LineOp[] = [];
  const equal = (i: number, j: number): void => {
    out.push({ op: DIFF_OP.equal, text: a[i] ?? '', oldLine: i + 1, newLine: j + 1 });
  };
  for (let i = 0; i < head; i++) equal(i, i);
  const edits = midA.length === 0 || midB.length === 0 ? null : myers(midA, midB);
  if (edits === null) {
    midA.forEach((text, i) => out.push({ op: DIFF_OP.remove, text, oldLine: head + i + 1, newLine: null }));
    midB.forEach((text, j) => out.push({ op: DIFF_OP.add, text, oldLine: null, newLine: head + j + 1 }));
  } else {
    for (const e of edits) {
      if (e.op === 'equal') equal(head + e.ai, head + e.bi);
      else if (e.op === 'remove')
        out.push({ op: DIFF_OP.remove, text: midA[e.ai] ?? '', oldLine: head + e.ai + 1, newLine: null });
      else out.push({ op: DIFF_OP.add, text: midB[e.bi] ?? '', oldLine: null, newLine: head + e.bi + 1 });
    }
  }
  for (let t = tail; t > 0; t--) equal(a.length - t, b.length - t);
  return out;
}

/** The new lines the diff describes, built from the old ones: `applyDiff(a, lineDiff(a, b))` is `b`. */
export function applyDiff(a: readonly string[], ops: readonly LineOp[]): string[] {
  const out: string[] = [];
  for (const o of ops) {
    if (o.op === DIFF_OP.equal) out.push(a[(o.oldLine ?? 1) - 1] ?? '');
    else if (o.op === DIFF_OP.add) out.push(o.text);
  }
  return out;
}

/** A row of the rendered diff: a line, or a run of unchanged lines folded away (`from` is its index in the op list). */
export type DiffRow =
  | { readonly kind: 'line'; readonly op: LineOp; readonly index: number }
  | { readonly kind: 'folded'; readonly count: number; readonly from: number };

/** Folds every run of unchanged lines longer than twice `context` to one row, keeping `context` lines next to a change. */
export function collapse(ops: readonly LineOp[], context: number): readonly DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < ops.length) {
    if ((ops[i] as LineOp).op !== DIFF_OP.equal) {
      rows.push({ kind: 'line', op: ops[i] as LineOp, index: i });
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && (ops[j] as LineOp).op === DIFF_OP.equal) j++;
    const first = i === 0;
    const last = j === ops.length;
    const keepHead = first ? 0 : context;
    const keepTail = last ? 0 : context;
    if (j - i <= keepHead + keepTail + (first || last ? 0 : context)) {
      // a short run between changes (or at an edge with nothing worth folding) stays open
      if (!(first && last)) {
        for (let k = i; k < j; k++) rows.push({ kind: 'line', op: ops[k] as LineOp, index: k });
        i = j;
        continue;
      }
    }
    for (let k = i; k < i + keepHead; k++) rows.push({ kind: 'line', op: ops[k] as LineOp, index: k });
    rows.push({ kind: 'folded', count: j - i - keepHead - keepTail, from: i + keepHead });
    for (let k = j - keepTail; k < j; k++) rows.push({ kind: 'line', op: ops[k] as LineOp, index: k });
    i = j;
  }
  return rows;
}
