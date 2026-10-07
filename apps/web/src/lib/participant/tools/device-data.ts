/**
 * The device boot of the tool streams (B-020, WP-684): the one `createToolData` of the device, over its own IndexedDB
 * database, the real routes (`/api/p/<project>/tools/<key>`) and the `event: tool` doorbell. Which streams the person
 * has is core's `toolAvailabilityFor` (the rule the server's access check uses, R1), asked of the config on the device
 * at each call, so a stream appears when its config does. A send is drained at once (`kick`); the lifecycle pulls
 * (open, online, visible, doorbell) are `createAutoSync`'s, which `startSync` runs with this service.
 */
import {
  createToolData,
  httpToolDataTransport,
  idbBackend,
  openToolDataStore,
  webQueueLock,
  type IdbEnv,
  type KeyedSignal,
  type LockManagerLike,
  type Timers,
  type ToolData,
} from '@ueberblick/client';
import type { Key, TemplateFile } from '@ueberblick/core/model';
import { toolAvailabilityFor } from '@ueberblick/core/registry/tools';
import type { Clock } from '@ueberblick/core/ports';
import type { ToolDataSource } from '@ueberblick/ui/tool-api';
import type { FetchLike } from '../http';
import { availableToolKeys } from './data';
import { createToolBadges, type ToolBadges } from './badges';
import { dataToolKeys } from './manifest';

export interface DeviceToolDataDeps {
  /** The device's database name (`ub-<project>-<participant>`); the tool data database is `<name>-tooldata`. */
  readonly name: string;
  readonly project: string;
  /** The participant's role keys: the same set the server checks. */
  readonly roles: readonly Key[];
  /** The project file on the device; undefined until it is there. */
  readonly file: () => TemplateFile | undefined;
  readonly fetch: FetchLike;
  readonly idb: IdbEnv;
  readonly clock: Clock;
  /** A new item id: a UUID (8 to 64 letters, digits or hyphens). */
  readonly newId: () => string;
  readonly timers: Timers;
  readonly locks: LockManagerLike | undefined;
  readonly doorbell: KeyedSignal;
  /** The signed-in person's id. */
  readonly self: () => string;
  readonly onError: (where: string, error: unknown) => void;
}

/** The `ctx.data` source of the tool host: a tool with a stream gets its handle, which is already a `ToolDataPort`. */
export function toolDataSource(
  service: Pick<ToolData, 'handle'>,
  hasStream: (toolKey: string) => boolean,
): ToolDataSource {
  return { forTool: (key) => (hasStream(key) ? service.handle(key) : undefined) };
}

export interface DeviceToolData {
  readonly service: ToolData;
  /** What the tools report for the Werkzeuge badge. */
  readonly badges: ToolBadges;
  /** The `ctx.data` source of the tool host. */
  readonly source: ToolDataSource;
  /** The tool keys this person has a stream for, now. */
  available(): readonly string[];
  close(): void;
}

export async function openDeviceToolData(deps: DeviceToolDataDeps): Promise<DeviceToolData> {
  const store = await openToolDataStore(idbBackend(deps.idb, deps.name));
  const keys = dataToolKeys();
  const available = (): readonly string[] => {
    const file = deps.file();
    return file === undefined ? [] : availableToolKeys((k) => toolAvailabilityFor(file, deps.roles, k), keys);
  };
  const service: ToolData = createToolData({
    store,
    transport: httpToolDataTransport(deps.project, ((input, init) =>
      deps.fetch(String(input), init)) as typeof fetch),
    available,
    self: deps.self,
    clock: deps.clock,
    newId: deps.newId,
    timers: deps.timers,
    doorbell: deps.doorbell,
    ...(deps.locks === undefined ? {} : { lock: webQueueLock(deps.locks, `${deps.name}:tooldata`) }),
    kick: () => void service.drain().catch((e: unknown) => deps.onError('tooldata:drain', e)),
    onError: (e) => deps.onError('tooldata', e),
  });
  const badges = createToolBadges({ data: service, keys, self: deps.self() });
  return {
    service,
    badges,
    source: toolDataSource(service, (k) => available().includes(k)),
    available,
    close() {
      badges.close();
      service.close();
      store.close();
    },
  };
}
