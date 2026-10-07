import type { ListRow } from '../view-source';

/** Lets the main thread breathe between two slices (WP-805, R14: no task over the long-task budget). */
export const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export interface ChunkedReader {
  /**
   * Reads every slice of `chunks` through `take` (which may drop or rename rows), yielding between slices. A new
   * `read` cancels the running one: the cancelled one resolves `undefined`, the newest one resolves its rows.
   */
  read(
    chunks: Iterable<readonly ListRow[]>,
    take: (slice: readonly ListRow[]) => readonly ListRow[],
  ): Promise<ListRow[] | undefined>;
  /** Cancels the running read (the Liste was hidden, or a burst made it stale). */
  cancel(): void;
  readonly running: boolean;
}

export function createChunkedReader(pause: () => Promise<void> = yieldToMain): ChunkedReader {
  let token = 0;
  let running = false;
  return {
    get running() {
      return running;
    },
    cancel() {
      token++;
      running = false;
    },
    async read(chunks, take) {
      const mine = ++token;
      running = true;
      const out: ListRow[] = [];
      for (const slice of chunks) {
        out.push(...take(slice));
        await pause();
        if (mine !== token) return undefined;
      }
      running = false;
      return out;
    },
  };
}
