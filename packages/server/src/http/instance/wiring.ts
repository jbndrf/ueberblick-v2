import type { Auth } from '../../auth';
import type { Db } from '../../db/driver';
import { createInstanceStore, type InstanceStore } from '../../instance';
import { createInstanceHandlers, type InstanceHandlers } from './handlers';

/** What `instanceHandlersFor` reads from a runtime (`Runtime` in apps/web satisfies it structurally). */
export interface InstanceRuntimeDeps {
  readonly control: Db;
  readonly auth: Pick<Auth, 'authenticate'>;
  readonly clock: { now(): string };
  readonly secureCookies: boolean;
}

const shared = new WeakMap<object, { store: InstanceStore; handlers: InstanceHandlers }>();

function parts(rt: InstanceRuntimeDeps) {
  let p = shared.get(rt);
  if (p === undefined) {
    const store = createInstanceStore(rt.control, rt.clock);
    p = {
      store,
      handlers: createInstanceHandlers({ auth: rt.auth, store, secureCookies: rt.secureCookies }),
    };
    shared.set(rt, p);
  }
  return p;
}

/** The instance store of a runtime, memoised on it (the exchange handler reads the consent gate from it). */
export const instanceStoreFor = (rt: InstanceRuntimeDeps): InstanceStore => parts(rt).store;
/** The instance handlers of a runtime, memoised on it. Route files delegate here. */
export const instanceHandlersFor = (rt: InstanceRuntimeDeps): InstanceHandlers => parts(rt).handlers;
