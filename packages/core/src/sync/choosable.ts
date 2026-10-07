import { scopeFingerprint } from './fingerprint';

/**
 * The hash of a choosable set (WP-725): `''` for no one, else a fingerprint of the sorted `id`/`name` pairs. The
 * device sends the hash of the set it holds; the server ships the list only when its own hash differs.
 */
export function choosableHash(people: readonly { readonly id: string; readonly name: string }[]): string {
  if (people.length === 0) return '';
  return scopeFingerprint(people.map((p) => `${p.id.length}:${p.id}${p.name}`));
}
