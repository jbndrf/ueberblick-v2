import type { DeviceStore, RunQueue } from '@ueberblick/client';

/**
 * A closed device is silent (WP-792). The screen is replaced only once the next device is open (an admin changed the
 * roles, WP-784), so for a moment sheets of the old screen still listen to and read from a device that is gone: its
 * queue rings nobody, and its stored runs read as none, instead of a read on the closed database failing unhandled.
 */
export function silentWhenClosed(
  store: DeviceStore,
  queue: RunQueue,
  isClosed: () => boolean,
): { readonly store: DeviceStore; readonly queue: RunQueue } {
  return {
    store: new Proxy(store, {
      get(target, key) {
        if (key === 'readRuns' && isClosed()) return async () => [];
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    queue: {
      ...queue,
      subscribe: (fn) => queue.subscribe((...a) => (isClosed() ? undefined : fn(...a))),
    },
  };
}
