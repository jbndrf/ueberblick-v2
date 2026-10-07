/**
 * The device runtime of one participant in one project: store, config versions, run queue, sync, and the readers the
 * sheets use. This module is the lazy chunk (it brings `@ueberblick/client`, core geo, core.plan and core.form); the
 * shell chunk holds only its types. Every side effect is a port (`DevicePorts`), so it runs under test with
 * fake-indexeddb and a scripted `fetch`, and in the browser with the platform (`browser.ts`).
 *
 * Nothing here is global: `openDevice` returns everything it made, and `close` lets go of it (H4: another scope is
 * another `openDevice`).
 */
import {
  createRunQueue,
  decodingTransport,
  lateVersionsSink,
  inlineDecoder,
  noLock,
  openConfigVersions,
  type ConfigVersions,
  readStorageHealth,
  webQueueLock,
  type DeviceStore,
  type EvictionMarker,
  type IdbEnv,
  type KeyedSignal,
  type LockManagerLike,
  type RunQueue,
  type Signal,
  type StoragePort as HealthPort,
  type Timers,
  versionsSink,
} from '@ueberblick/client';
import { createGeo, type Geo } from '@ueberblick/core/geo';
import { hydrate, type CompiledConfig } from '@ueberblick/core/hydrate';
import type { Actor, FeatureState, FeatureId, Key } from '@ueberblick/core/model';
import type { StorageState } from '@ueberblick/core/registry';
import type { Clock, Ids } from '@ueberblick/core/ports';
import type { DraftStore, RunSubmitter } from '@ueberblick/ui';
import type { TextSearchPort } from '@ueberblick/ui/tool-api';
import { createDeviceBlobs, type PendingBlobs } from './blob-shelf';
import { createDraftStore, type StoragePort } from './drafts';
import { ALL, changedSignal, type ChangeFeed } from './changed';
import { touchedByPredictions, type TouchedSink } from './view-source-touched';
import { toolSettings } from './tools';
import { createChatLink, type ChatLink } from './tools/chat-link';
import { openDeviceToolData, type DeviceToolData } from './tools/device-data';
import type { BootstrapIdentity, DeviceStart, FetchLike } from './http';
import { createDeviceIds, type RandomBytes } from './ids';
import { identityOf } from './decode';
import { deviceName, draftScope, initKey } from './device-names';
import { hostFaultProblem } from './host-fault';
import { roleKeyOf } from './model';
import { createRolesLive } from './roles-live.svelte';
import { silentWhenClosed } from './closed-device';
import { createProblemLog, type ProblemLog } from './notices';
import { createReader, type Reader } from './reader';
import { startSync, type SyncHandle, type SyncHostChoice } from './start-sync';
import { sessionGuard } from './session-guard';
import { createSubmitter } from './submitter';
import { fieldLabelOf } from './refusals';
import { createEncodedSyncTransport } from './sync-transport';
import { createBlobTransport, createConfigFetcher, createRunTransport } from './transports';
import type { Network } from './network';
import { classifiedFor } from '@ueberblick/core/perms';
import { createViewList, createViewSource, type ViewFeatureSource, type ViewList } from './view-source';

export interface DevicePorts {
  readonly fetch: FetchLike;
  readonly idb: IdbEnv;
  readonly storage: StoragePort; // localStorage: the eviction marker and the drafts
  readonly health: HealthPort;
  /** Where the sync pipeline runs: a Web Worker in the browser, this thread under test. */
  readonly sync: SyncHostChoice;
  readonly clock: Clock;
  readonly random: RandomBytes;
  readonly timers: Timers;
  readonly mono: () => number;
  readonly locks: LockManagerLike | undefined;
  /** Online means the server answers (WP-734). */
  readonly network: Network;
  readonly visible: Signal;
  readonly doorbell: (project: string) => Signal;
  /** The `event: tool` doorbell of the project's SSE stream: rings with the tool key (B-020). */
  readonly toolDoorbell: (project: string) => KeyedSignal;
  /** Trouble for the console; a host fault also joins `Device.problems`. */
  readonly onError: (where: string, error: unknown) => void;
}

export interface Device {
  readonly project: string;
  readonly participant: BootstrapIdentity['participant'];
  /** What the header and the profile card show. */
  readonly identity: BootstrapIdentity;
  readonly actor: Actor;
  readonly roleKey: string | undefined;
  readonly version: number;
  readonly config: CompiledConfig;
  /** `config` as this person sees the classification (WP-1075): a type whose classifying property they may not read has none. Read by the map, the Objekte list, the cluster rows and the filter. */
  readonly classified: CompiledConfig;
  readonly geo: Geo;
  readonly store: DeviceStore;
  readonly queue: RunQueue;
  readonly sync: SyncHandle;
  readonly reader: Reader;
  readonly submitter: RunSubmitter;
  readonly blobs: PendingBlobs;
  readonly drafts: DraftStore;
  readonly ids: Ids;
  readonly clock: Clock;
  readonly network: Network;
  /** The fetch of everything the device asks of `/api/p/<project>/`: names the participant, stops on a turned session (WP-768). */
  readonly fetch: FetchLike;
  /** Rings (coalesced) with the features that may have changed: a pulled page's ids, or all. */
  readonly changed: ChangeFeed;
  readonly searchText: TextSearchPort;
  /** Faults in the config the app cannot fix: shown, never hidden. */
  readonly problems: ProblemLog;
  /** The tool streams (`ctx.data`, B-020): one mirror, outbox and read marks per device. */
  readonly toolData: DeviceToolData['service'];
  readonly toolSource: DeviceToolData['source'];
  readonly toolBadges: DeviceToolData['badges'];
  /** "Im Chat erwähnen": the feature sheet seeds the chat and asks the shell to open it. */
  readonly chat: ChatLink;
  /** The same person's roles changed (WP-796): the device stays, what derives from the roles follows. Returns the stop. */
  onRolesChange(fn: () => void): () => void;
  /** Applies new roles in place: true when they differ. Database, queue and drafts are untouched. */
  updateRoles(roles: readonly string[]): boolean;
  /** Rings on a scope change of a pull or sync now (roles may have changed, WP-784); returns the stop. */
  onAccessCheck(fn: () => void): () => void;
  viewSource(viewKey: string): ViewFeatureSource;
  viewList(viewKey: string): ViewList;
  feature(id: FeatureId): FeatureState | undefined;
  storageState(): Promise<StorageState>;
  close(): void;
}

const COALESCE_MS = 200;

const localMarker = (storage: StoragePort, name: string): EvictionMarker => ({
  isInitialised: () => storage.getItem(initKey(name)) !== null,
  markInitialised: () => storage.setItem(initKey(name), '1'),
});

export async function openDevice(
  bootstrap: DeviceStart,
  ports: DevicePorts,
  locale: string,
): Promise<Device> {
  const { participant } = bootstrap;
  const project = bootstrap.project.key;
  const name = deviceName(project, participant.id);
  const geo = createGeo();
  const ids = createDeviceIds(ports.clock, ports.random);
  const problems = createProblemLog();
  // Runs and files are sent only while the server answers (WP-734). Every request goes through the session guard
  // (WP-768): a cookie turned to another participant by a second tab stops this device.
  const guarded = sessionGuard(ports.fetch, participant.id);
  const sendFetch: FetchLike = (input, init) =>
    ports.network.current()
      ? guarded(input, init)
      : Promise.reject(new TypeError('The server is not reachable.'));

  // The roles are one reactive value (WP-796): actor and person read it live, so a change needs no new device.
  const live = createRolesLive(participant.roles);
  const actor: Actor = {
    id: participant.id,
    kind: 'participant',
    get roles(): readonly Key[] {
      return live.roles() as readonly Key[];
    },
  };

  // The host opens the store, then `queueFor` builds everything that needs it.
  let built: { config: CompiledConfig; versions: ConfigVersions; queue: RunQueue } | undefined;
  // The tool streams (WP-684): their own database, no part of the feature store. Which streams the person has is
  // asked of the config once it is on the device (`built`), so none is pulled before that.
  const toolData = await openDeviceToolData({
    name,
    project,
    get roles() {
      return actor.roles;
    },
    file: () => built?.config.file,
    fetch: guarded,
    idb: ports.idb,
    clock: ports.clock,
    newId: () => ids.runId(),
    timers: ports.timers,
    locks: ports.locks,
    doorbell: ports.toolDoorbell(project),
    self: () => participant.id,
    onError: (where, e) => ports.onError(where, e),
  });
  const accessListeners = new Set<() => void>();
  let touched: TouchedSink = () => undefined; // WP-800: the features a queued prediction touches
  // The sync host reports page headers and pulls here; `ConfigVersions` binds once it exists (WP-669).
  const versionsFeed = lateVersionsSink();
  const sync = await startSync({
    name,
    project,
    participant: participant.id,
    options: {
      env: ports.idb,
      marker: localMarker(ports.storage, name),
      onIssue: (issue) => ports.onError(`store:${issue.code}`, issue.message),
    },
    host: ports.sync,
    transport: decodingTransport(createEncodedSyncTransport(project, guarded), inlineDecoder),
    clock: ports.clock,
    timers: ports.timers,
    doorbell: ports.doorbell(project),
    online: ports.network.becameReachable,
    reachable: ports.network.current,
    visible: ports.visible,
    tools: toolData.service,
    versions: versionsFeed,
    onAccessCheck: () => accessListeners.forEach((fn) => fn()),
    ...(bootstrap.access === undefined ? {} : { access: bootstrap.access }),
    onError: (trigger, error) => {
      ports.onError(`sync:${trigger}`, error);
      // a fault of the host itself (the worker) is said to the person, never only logged (WP-656)
      const fault = trigger === 'host' ? hostFaultProblem(error) : undefined;
      if (fault !== undefined) problems.report(fault);
    },
    async queueFor(store) {
      // The bootstrapped config is validated by core `hydrate` (it throws on a mismatch) and kept for its queued runs.
      // An offline start brings none: the version is in the store from the last online start.
      if (bootstrap.compiled !== undefined) {
        hydrate(bootstrap.compiled);
        await store.putConfigVersion(bootstrap.version, bootstrap.compiled);
      }
      const versions = await openConfigVersions({
        store,
        fetcher: createConfigFetcher(project, ports.fetch),
      });
      versionsFeed.bind(versionsSink({ versions, store }));
      const config = versions.get(bootstrap.version);
      if (config === 'refetching')
        throw new Error(`Config version ${bootstrap.version} cannot be read by this app.`);
      const roleKey = roleKeyOf(config.file, participant.roles);

      // Text search: every `tools.search.sources` entry of the role is indexed (R1: the lazy tool chunk reads its own
      // settings). A bad setting disables the search tool, never the app.
      const searchSettings = toolSettings(config.file, roleKey ?? '', 'search');
      if (searchSettings !== undefined) {
        try {
          const { readSearchSources } = await import('@ueberblick/tool-search');
          for (const source of readSearchSources(searchSettings))
            store.indexText(source.type, source.property);
        } catch (e) {
          problems.report({
            code: 'tool_setting_invalid',
            subject: 'search',
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const queue = await createRunQueue({
        store: touchedByPredictions(store, (t) => touched(t)),
        config: versions,
        transport: createRunTransport(project, sendFetch),
        blobTransport: createBlobTransport(project, sendFetch),
        lock: ports.locks ? webQueueLock(ports.locks, `${name}:queue`) : noLock,
        clock: ports.clock,
        ids,
        mono: ports.mono,
        timers: ports.timers,
        geo,
        onError: (e) => ports.onError('queue:retry', e),
      });
      built = { config, versions, queue };
      return queue;
    },
  }).catch((e: unknown) => {
    toolData.close(); // not open behind a failed start
    throw e;
  });
  if (built === undefined) {
    toolData.close();
    throw new Error('The device runtime did not build the run queue.');
  }
  const { config, versions } = built;
  let shownPerson = participant;
  const personNow = (): BootstrapIdentity['participant'] => {
    if (shownPerson.roles !== live.roles()) shownPerson = { ...participant, roles: [...live.roles()] };
    return shownPerson;
  };
  let closed = false;
  const { store, queue } = silentWhenClosed(sync.store, built.queue, () => closed);
  const viewDeps = (viewKey: string) => ({
    facts: store.facts,
    config: classifiedFor(config, actor),
    viewKey,
    actor,
    geo,
    now: () => ports.clock.now(),
  });

  queue.drain().catch((e: unknown) => ports.onError('drain', e));

  // The map and sheets re-read the features a queued prediction touches and a committed page's ids; a queue change
  // that moves no prediction rings with no ids (WP-800, R14).
  const changed = changedSignal(
    [
      (notify) => ((touched = notify), queue.subscribe(() => notify([]))),
      // a config version arrived: sheets that waited for it re-read (WP-675)
      (notify) => versions.subscribe(() => notify(ALL)),
      // the roles changed: the tasks on offer and the role's views differ for every feature (WP-796)
      (notify) => live.subscribe(() => notify(ALL)),
      (notify) =>
        store.onChange((c) => {
          if (c.kind === 'page') notify(c.featureIds);
          else if (c.kind === 'cleared' || c.kind === 'reloaded') notify(ALL);
        }),
    ],
    ports.timers,
    COALESCE_MS,
  );
  const blobs = createDeviceBlobs(ports.idb, project, participant.id, (sha256) => store.blobs.has(sha256));
  const reader = createReader({
    facts: store.facts,
    versions,
    bootstrapVersion: bootstrap.version,
    actor,
    geo,
    clock: ports.clock,
    ids,
    locale,
    activity: store,
    actorName: participant.name,
  });

  return {
    project,
    get participant() {
      return personNow();
    },
    identity: identityOf(bootstrap),
    actor,
    get roleKey() {
      return roleKeyOf(config.file, live.roles());
    },
    version: bootstrap.version,
    config,
    get classified() {
      return classifiedFor(config, actor);
    },
    geo,
    store,
    queue,
    sync,
    reader,
    submitter: createSubmitter({
      queue,
      store,
      actor,
      configVersion: bootstrap.version,
      blobs,
      locale: locale === 'en' ? 'en' : 'de',
      fieldLabel: fieldLabelOf(config.file, locale === 'en' ? 'en' : 'de'),
      onError: (e) => ports.onError('submit', e),
    }),
    blobs,
    drafts: createDraftStore(ports.storage, draftScope(project, participant.id), blobs),
    ids,
    clock: ports.clock,
    network: ports.network,
    fetch: guarded,
    changed,
    problems,
    toolData: toolData.service,
    toolSource: toolData.source,
    toolBadges: toolData.badges,
    chat: createChatLink(),
    searchText: (sources, query, limit) => store.searchText(sources, query, limit),
    onRolesChange: (fn) => live.subscribe(fn),
    updateRoles: (roles) => live.set(roles),
    onAccessCheck(fn) {
      accessListeners.add(fn);
      return () => void accessListeners.delete(fn);
    },
    viewSource: (viewKey) => createViewSource({ ...viewDeps(viewKey), changed }),
    viewList: (viewKey) => createViewList({ ...viewDeps(viewKey), locales: [locale] }),
    feature: (id) => store.facts.feature(id),
    async storageState() {
      const health = await readStorageHealth(ports.health, { requestPersist: true });
      return health.atRisk ? 'at_risk' : 'ok';
    },
    close() {
      closed = true;
      changed.stop();
      sync.stop(); // closes the host: the worker ends and the store closes
      toolData.close();
      blobs.close(); // an open shelf connection would hold the sign-out delete pending
    },
  };
}
