import type { RegistryEntry } from '@ueberblick/core';

/** `('a','b')` for a CHECK ... IN clause, generated from a registry so values are never typed twice (R1, R6). */
export function inList(registry: { readonly entries: readonly RegistryEntry[] }): string {
  return `(${registry.entries.map((e) => `'${e.key.replaceAll("'", "''")}'`).join(',')})`;
}
