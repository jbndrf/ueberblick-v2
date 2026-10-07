// The visible window of a long list whose rows have different heights (the chat thread, R14: 10,000 messages must
// not become 10,000 DOM rows). Heights are estimates until a row has been measured; the prefix sums give the
// offset of every row, and the window is found by binary search, so a scroll costs O(log n + rows shown).

/** The estimated height of a group of messages before it is measured, in px. */
export const ESTIMATED_ROW_PX = 72;
/** Rows drawn above and below the viewport, so a fast scroll does not show blanks. */
export const OVERSCAN_ROWS = 6;

export interface RowWindow {
  /** First row drawn. */
  readonly from: number;
  /** One past the last row drawn. */
  readonly to: number;
  /** Space above the first drawn row, in px. */
  readonly before: number;
  /** Space below the last drawn row, in px. */
  readonly after: number;
  readonly total: number;
}

/** `offsets[i]` is where row `i` starts; `offsets[n]` is the total height. */
export function offsetsOf(heights: ArrayLike<number>): Float64Array {
  const out = new Float64Array(heights.length + 1);
  for (let i = 0; i < heights.length; i++) out[i + 1] = (out[i] as number) + (heights[i] as number);
  return out;
}

/** The row that contains the pixel `y` (the last row for a `y` below the end). */
export function rowAt(offsets: Float64Array, y: number): number {
  const n = offsets.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] as number) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function windowOf(
  offsets: Float64Array,
  scrollTop: number,
  viewport: number,
  overscan = OVERSCAN_ROWS,
): RowWindow {
  const n = offsets.length - 1;
  const total = offsets[n] as number;
  if (n <= 0) return { from: 0, to: 0, before: 0, after: 0, total };
  const first = rowAt(offsets, Math.max(0, scrollTop));
  const last = rowAt(offsets, Math.max(0, scrollTop) + Math.max(1, viewport));
  const from = Math.max(0, first - overscan);
  const to = Math.min(n, last + 1 + overscan);
  return { from, to, before: offsets[from] as number, after: total - (offsets[to] as number), total };
}
