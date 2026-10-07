import { getContext, setContext } from 'svelte';
import type { FilterValue } from './types';

/** What the table hands its column headers in query mode (a context, so the header rows need no extra props). */
export interface ServerContext {
  /** Values of one column with counts; absent: the filter list counts the rows in memory. */
  filterValues?: ((columnKey: string) => Promise<FilterValue[]>) | undefined;
  loadingLabel?: string | undefined;
}

const KEY = Symbol('base-table-server');

export function provideServerContext(get: () => ServerContext): void {
  setContext(KEY, get);
}
/** Reads the table's current values on each access (the props may change). */
export function serverContext(): ServerContext {
  const get = getContext<(() => ServerContext) | undefined>(KEY) ?? ((): ServerContext => ({}));
  return {
    get filterValues() {
      return get().filterValues;
    },
    get loadingLabel() {
      return get().loadingLabel;
    },
  };
}
