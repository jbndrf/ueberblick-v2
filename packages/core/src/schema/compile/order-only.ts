/**
 * The one rule for "this change touches no feature" (WP-411, WP-414, A-042): a set of diff entries is order-only when it
 * is not empty and every entry is an `order_changed`. A reorder is served config but changes no value, so the builder's
 * `affected` count and the server's keep / move choice both leave such a type out. Pure.
 */
import type { DiffEntry } from './contract';

export function isOrderOnly(changes: readonly Pick<DiffEntry, 'change'>[]): boolean {
  return changes.length > 0 && changes.every((c) => c.change === 'order_changed');
}
