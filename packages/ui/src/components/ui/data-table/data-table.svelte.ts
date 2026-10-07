import {
  type RowData,
  type TableOptions,
  type TableOptionsResolved,
  type TableState,
  type Updater,
  createTable,
} from '@tanstack/table-core';

/** A reactive TanStack table for Svelte 5 (v3's `createSvelteTable`): table state lives in a rune, options are re-read on every change. */
export function createSvelteTable<TData extends RowData>(options: TableOptions<TData>) {
  const resolvedOptions = mergeObjects<TableOptionsResolved<TData>>(
    {
      state: {},
      onStateChange() {},
      renderFallbackValue: null,
      mergeOptions: (defaults: object, overrides: object) => mergeObjects(defaults, overrides),
    },
    options,
  );

  const table = createTable(resolvedOptions);
  let state = $state<Partial<TableState>>(table.initialState);

  function updateOptions() {
    table.setOptions((prev) =>
      mergeObjects<TableOptionsResolved<TData>>(prev, options, {
        state: mergeObjects(state, options.state ?? {}),
        onStateChange: (updater: Updater<TableState>) => {
          state = typeof updater === 'function' ? updater(state as TableState) : mergeObjects(state, updater);
          options.onStateChange?.(updater);
        },
      }),
    );
  }

  updateOptions();
  $effect.pre(() => {
    updateOptions();
  });
  return table;
}

type Source = object | (() => object | null | undefined);

/**
 * Lazily merges objects (or thunks of objects) and keeps getter semantics of every source.
 * Proxy-based to avoid a known WebKit recursion issue. Later sources win.
 */
export function mergeObjects<T extends object>(...sources: readonly Source[]): T {
  const resolve = (src: Source): Record<PropertyKey, unknown> | undefined =>
    (typeof src === 'function' ? (src() ?? undefined) : src) as Record<PropertyKey, unknown> | undefined;

  const findSourceWithKey = (key: PropertyKey) => {
    for (let i = sources.length - 1; i >= 0; i--) {
      const obj = resolve(sources[i] as Source);
      if (obj && key in obj) return obj;
    }
    return undefined;
  };

  return new Proxy(Object.create(null) as T, {
    get(_, key) {
      return findSourceWithKey(key)?.[key];
    },
    has(_, key) {
      return !!findSourceWithKey(key);
    },
    ownKeys(): (string | symbol)[] {
      const all = new Set<string | symbol>();
      for (const s of sources) {
        const obj = resolve(s);
        if (obj) for (const k of Reflect.ownKeys(obj)) all.add(k);
      }
      return [...all];
    },
    getOwnPropertyDescriptor(_, key) {
      const src = findSourceWithKey(key);
      if (!src) return undefined;
      return { configurable: true, enumerable: true, value: src[key], writable: true };
    },
  });
}
