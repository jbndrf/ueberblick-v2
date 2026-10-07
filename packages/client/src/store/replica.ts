/**
 * How a read replica applies the writer's notices to its memory mirror (B-012). Pure of I/O: the store owns the
 * mirror and passes it in, and does the notifying.
 */
import type { FeatureId } from '@ueberblick/core/model';
import { sameCursor, toChange, type CommitNotice } from './commit';
import type { StoreChange } from './contract';
import type { MemoryIndex } from './memory';
import { commitPlan } from './plan';

/** A page that arrives in slices, after slice `next - 1`. */
export interface SliceState {
  readonly next: number;
  readonly ids: ReadonlySet<FeatureId>;
}

export interface NoticeResult {
  readonly applied: boolean;
  readonly sliced: SliceState | undefined;
  /** Set when the notice completed a change subscribers should hear about. */
  readonly change?: StoreChange;
}

const REFUSED: NoticeResult = { applied: false, sliced: undefined };

/**
 * Applies one notice with the same `commitPlan` the writer ran. A big page arrives as several slices, each
 * applied in its own task; the cursor and the one change follow the last slice. Refuses (`applied: false`,
 * nothing touched) when the notice does not continue this copy: a first notice must start at the mirror's
 * cursor, a later slice must be the next one.
 */
export function applyNoticeToMirror(
  mem: MemoryIndex,
  open: SliceState | undefined,
  notice: CommitNotice,
): NoticeResult {
  const part = notice.part;
  const continues = open
    ? part?.index === open.next
    : (part?.index ?? 0) === 0 && sameCursor(notice.from, mem.cursor);
  if (!continues) return REFUSED;
  const c = notice.commit;
  if (c.kind === 'page') {
    commitPlan(mem, c.plan);
    const ids = new Set(open?.ids);
    for (const f of c.plan.featurePuts) ids.add(f.id);
    for (const id of c.plan.featureDeletes) ids.add(id);
    if (part && part.index + 1 < part.count) return { applied: true, sliced: { next: part.index + 1, ids } };
    mem.cursor = c.cursor;
    return {
      applied: true,
      sliced: undefined,
      change: { kind: 'page', featureIds: [...ids], cursor: c.cursor },
    };
  }
  if (c.kind === 'cleared') mem.clearCache();
  else if (c.kind === 'history_dropped') mem.dropHistoryOf(c.featureId, c.properties);
  else return { applied: true, sliced: undefined }; // a blob_purge is applied by the store on its own connection
  return { applied: true, sliced: undefined, change: toChange(c) };
}
