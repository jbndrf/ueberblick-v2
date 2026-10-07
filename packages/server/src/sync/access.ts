import { scopeFingerprint, type Actor } from '@ueberblick/core';

/**
 * The pull header's `access` (WP-793): a hash of the actor's sorted role keys, O(roles). It is kept apart from the
 * scope fingerprint so a role change that leaves visibility alone rings the device without a re-snapshot. Anything
 * else that decides task availability per actor (H2 role-app config) joins the inputs here.
 */
export function accessOf(actor: Actor): string {
  return scopeFingerprint(['access', ...[...actor.roles].sort()]);
}
