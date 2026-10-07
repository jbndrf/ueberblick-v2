/**
 * The browser adapter for tab coordination: the platform's Web Locks manager and a `BroadcastChannel` named after
 * the database. The only place that touches those globals; everything else takes the `TabCoordination` port.
 * A platform without them is an error, not a silent single tab (R11): pass no `tabs` option on purpose instead.
 */
import type { BroadcastChannelLike, SyncLockManagerLike, TabCoordination } from './tabs';

/** The page is not a secure context (plain http): Web Locks and service workers do not exist there. Fix: serve https. */
export class InsecureContextError extends Error {
  constructor() {
    super('this page is not a secure context (plain http): serve the app over https');
    this.name = 'InsecureContextError';
  }
}

interface Platform {
  readonly isSecureContext?: boolean;
  readonly navigator?: { readonly locks?: SyncLockManagerLike };
  readonly BroadcastChannel?: new (name: string) => BroadcastChannelLike;
  readonly crypto?: { randomUUID(): string };
}

export function browserTabs(database: string, platform: Platform = globalThis as Platform): TabCoordination {
  if (platform.isSecureContext === false) throw new InsecureContextError();
  const locks = platform.navigator?.locks;
  const Channel = platform.BroadcastChannel;
  if (!locks || !Channel || !platform.crypto)
    throw new Error('this browser has no Web Locks or BroadcastChannel: several tabs cannot share the sync');
  return { locks, channel: new Channel(`ueberblick-sync:${database}`), tabId: platform.crypto.randomUUID() };
}
