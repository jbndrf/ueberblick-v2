/**
 * The one registry mechanism (F8). Every domain enum is a registry: a readonly
 * array of entries with a `key`. Types are derived from it — never hand-written unions (R6).
 */
export interface RegistryEntry<K extends string = string> {
  readonly key: K;
  readonly description: string;
}

export function defineRegistry<const E extends readonly RegistryEntry[]>(entries: E) {
  const keys = entries.map((e) => e.key) as { [I in keyof E]: E[I]['key'] };
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return {
    entries,
    keys,
    has: (key: string): key is E[number]['key'] => byKey.has(key),
    get: (key: E[number]['key']) => byKey.get(key) as E[number],
  } as const;
}

export type KeyOf<R extends { entries: readonly RegistryEntry[] }> = R['entries'][number]['key'];
