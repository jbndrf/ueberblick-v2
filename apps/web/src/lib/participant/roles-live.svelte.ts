/**
 * The roles of the open device as one reactive value (WP-796). v3 re-read its `roles` collection live and the running
 * map followed without a remount (`reference/src/routes/(participant)/map/+page.svelte:405`, `rolesLive`); here the
 * device holds the roles in one place, and everything that derives from them (the role key, the tasks on offer, the
 * role's tools and views, the profile card) reads them from here, so a change reaches it wherever it is read.
 */
export interface RolesLive {
  /** Reactive: a read inside a `$derived` or `$effect` follows the next `set`. */
  roles(): readonly string[];
  /** True when the set differs (order does not matter); the listeners are told once. */
  set(next: readonly string[]): boolean;
  subscribe(fn: () => void): () => void;
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((r) => b.includes(r));

export function createRolesLive(initial: readonly string[]): RolesLive {
  let current = $state.raw<readonly string[]>(initial);
  const listeners = new Set<() => void>();
  return {
    roles: () => current,
    set(next) {
      if (same(current, next)) return false;
      current = [...next];
      for (const l of [...listeners]) l();
      return true;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}
