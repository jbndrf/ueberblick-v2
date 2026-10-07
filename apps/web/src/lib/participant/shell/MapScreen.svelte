<script lang="ts">
  // The participant's working screen, v3's `/map`: the 56 px header, the full-screen map and the bottom bar; every
  // other function is a sheet over the map (`SheetHost`). What is shown is what the device's reader (core, R1) says.
  import { HEADER_VARS, LAYER } from '../layers';
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { FeatureId } from '@ueberblick/core/model';
  import {
    browserPosition,
    deriveShellModel,
    type ClusterTap,
    type MapHandle,
    type PositionPort,
  } from '@ueberblick/ui';
  import { type PrefsClient, type QueueStatus, type SyncStatus } from '@ueberblick/client';
  import type { Device } from '../device';
  import DownloadCard from '../offline/DownloadCard.svelte';
  import { browserOfflineContext } from './browser-offline';
  import type { OfflineContext } from '../offline/context';
  import { onReadyPacksChange } from '../offline/watch';
  import { centerOfExtent, tappableHandle } from '../map-view';
  import { message, type Locale } from '../messages';
  import { bindDeviceStatus, devicePrefsClient, projectIconUrl, providePhotoOf } from './device-status';
  import NoticeBar from '../NoticeBar.svelte';
  import ProblemBar from '../ProblemBar.svelte';
  import PreviewBanner from '../PreviewBanner.svelte';
  import type { AppProblem } from '../notices';
  import { syncNotice } from '../status';
  import { bindHidden, recordFilterController } from '../sheets/filter/filter-prefs';
  import { createDevicePrefs, startPrefs } from '../sheets/settings/prefs';
  import { bindLookToRecord, createRecordPrefs } from '../sheets/settings/prefs-record';
  import { sheetTools, toolEntries } from '../tools/entries';
  import { roleControllers } from './role-controllers.svelte';
  import { unclusterCap } from '../tools/cluster';
  import { applyThemeTokens } from './theme-style';
  import { bindToolSignals, toolsBadge, withChat } from './tool-signals';
  import type { BarItem } from './bar';
  import BottomBar from './BottomBar.svelte';
  import Header from './Header.svelte';
  import MapCanvas from './MapCanvas.svelte';
  import { afterMapTap, detailOpen, close, fabStep, stepFab, toggle, type Panels } from './panels';
  import { syncProgress } from './progress';
  import SheetHost from './SheetHost.svelte';
  import type { SheetLoader, SheetSlot, ShellContext } from './sheets';
  import { showStandort } from './standort';

  interface Props {
    device: Device;
    locale: Locale;
    /** Where the device's position comes from; the browser unless a test says otherwise. */
    position?: PositionPort;
    /** Ends the session on this device (the Einstellungen sheet offers it). */
    onsignout: () => Promise<boolean>;
    /** The person picked another language (the route re-renders in it). */
    onlocale: (locale: Locale) => void;
    /** Where the sheets come from; the registry. */
    registry?: ((slot: SheetSlot) => SheetLoader | undefined) | undefined;
    /** The person's preference record (tool switches); the device's cache and the server unless a test says otherwise. */
    toolPrefs?: PrefsClient;
    /** The offline map data, install state and storage numbers; the browser's unless a test says otherwise. */
    offlineContext?: OfflineContext;
  }
  let {
    device,
    locale,
    position = browserPosition,
    onsignout,
    onlocale,
    registry,
    toolPrefs,
    offlineContext,
  }: Props = $props();

  // The person's preference record (WP-612, cached on the device, edited offline): tool switches and Kartenlayer choice.
  const dev = untrack(() => device);
  const prefsClient: PrefsClient = untrack(() => toolPrefs) ?? devicePrefsClient(dev);
  // The offline map data (WP-650): packs are read before the map mounts.
  const offline: OfflineContext = untrack(() => offlineContext) ?? browserOfflineContext(dev, prefsClient);
  let packsRead = $state(!offline.offline.supported);

  // Every photo of the form and of Daten resolves through this one function (`photo-url.ts`, WP-630).
  onDestroy(providePhotoOf(dev, offline));

  let queueStatus: QueueStatus = $state(untrack(() => device.queue.status()));
  let syncStatus: SyncStatus = $state(untrack(() => device.sync.worker.status()));
  let problems: readonly AppProblem[] = $state(untrack(() => device.problems.list()));
  let online = $state(untrack(() => device.network.current())); // the server answers (WP-734)
  let mapHandle: MapHandle | undefined = $state();
  let listShown = $state(false);
  let canvas: { showMap: () => void } | undefined = $state();
  let open: Panels = $state([]);
  let featureId: FeatureId | null = $state(null);
  let cluster: ClusterTap | null = $state(null);
  let locationFailed = $state(false);
  /** The map has been idle once (v3 `isLoading` ends): until then the map and the header say that data is loading. */
  let mapIdle = $state(false);
  /** A pin is being placed: v3 hides the bottom bar then (`isSelectingCoordinates`). */
  let placing = $state(false);
  /** The create form is open; the picker over it is shown apart (v3: `workflowSelectorOpen`, which the form does not touch). */
  let formOpen = $state(false);
  let pickerShown = $state(false);
  let mainEl: HTMLElement | undefined = $state();
  let failedTimer: ReturnType<typeof setTimeout> | undefined;
  // One filter and one set of personal prefs per open app: the Filter sheet writes the first, the map reads it.
  const filter = untrack(() => recordFilterController(prefsClient, device.config.file));
  // Theme, font size and language: the record of the person, with the device values as cache (WP-695).
  const devicePrefs = createDevicePrefs({
    storage: localStorage,
    prefersDark: () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
    deviceLocale: untrack(() => locale),
  });
  const prefs = createRecordPrefs({ client: prefsClient, device: devicePrefs });

  // What the role decides (tools, views, layers), current when the roles change in place (WP-796).
  const role = roleControllers(
    untrack(() => device),
    prefsClient,
    filter,
  );
  const person = $derived(role.person);
  const layers = $derived(role.layers);
  const switches = $derived(role.switches);
  const clusterState = $derived(role.clusterState);
  // What the tools report for the Werkzeuge badge (v3: unread chat), counted on the device whether or not a panel is open.
  let toolBadges = $state(untrack(() => device.toolBadges.current()));
  const stops: (() => void)[] = [];
  onMount(() => {
    void offline.offline.ready.then(() => (packsRead = true));
    stops.push(() => offline.pwa.stop());
    stops.push(
      bindToolSignals(device, { badges: (b) => (toolBadges = b), openChat: () => (open = withChat(open)) }),
    );
    stops.push(bindHidden(filter, prefsClient)); // a record that arrives later (new device) reaches the switches
    void prefsClient.sync();
    startPrefs(prefs, document.documentElement); // a stored font size and theme apply before the sheet is opened
    // The record of another device (and the cached one) reaches the page, the cache and the language
    stops.push(
      bindLookToRecord({
        client: prefsClient,
        device: devicePrefs,
        port: prefs,
        root: document.documentElement,
        locale: untrack(() => locale),
        onlocale,
      }),
    );
    // Offline-Bilder follows the preference; photos that a sync brought in are fetched once it is idle (WP-667)
    void offline.images.start();
    stops.push(() => offline.images.stop());
    stops.push(
      bindDeviceStatus(device, offline, prefsClient, {
        queue: (v) => (queueStatus = v),
        sync: (v) => (syncStatus = v),
        problems: (v) => (problems = v),
        online: (v) => (online = v),
      }),
    );
  });
  onDestroy(() => {
    stops.forEach((s) => s());
    clearTimeout(failedTimer);
  });

  const file = $derived(device.config.file);
  // What a role may start with no feature: read again when the roles change (WP-796).
  const startable = $derived(device.reader.startableTasks());
  const shell = $derived(
    deriveShellModel({ file, roleKey: device.roleKey ?? '', locale, allowedTasks: startable }),
  );
  const toolList = $derived(toolEntries(file, device.roleKey ?? '', switches));
  const tools = $derived(sheetTools(toolList, problems));
  const cap = $derived(unclusterCap(toolList, clusterState));
  $effect(() => mapHandle?.setUncluster?.(cap));
  // The role's theme tokens go on the document root, so portalled sheets inherit them too (WP-714).
  $effect(() => applyThemeTokens(document.documentElement, shell.theme));
  // The project icon is a blob of the project (WP-611); the route serves it to a signed-in participant.
  const iconUrl = $derived(projectIconUrl(device));
  const badge = $derived(toolsBadge(toolBadges, tools, open));
  const notice = $derived(syncNotice({ queue: queueStatus, sync: syncStatus, locale }));

  const closeSlot = (slot: SheetSlot): void => void (open = close(open, slot));
  const ctx: ShellContext = $derived({
    device,
    locale,
    online,
    recentOpen: open.includes('recent'),
    closeSlot,
    setPlacing: (on) => (placing = on),
    pickerShown,
    setForm: (on) => ([formOpen, pickerShown] = [on, false]), // a pick or dismissal closes the picker (v3 `closeMenu`)
    map: tappableHandle(mapHandle, listShown),
    listShown,
    showMap: () => canvas?.showMap(),
    center: () => centerOfExtent(mapHandle),
    openChat: () => (open = withChat(open)),
    openFeature,
    viewKey: shell.home,
    filter,
    layers,
    tools: { entries: toolList, person },
    prefs,
    record: prefsClient,
    offline,
    manageTabs: () => (open = open.includes('settings') ? open : toggle(open, 'settings')),
    setLocale: onlocale,
    signOut: onsignout,
    detailOpen: detailOpen(open),
  });

  function openFeature(id: FeatureId): void {
    featureId = id;
    open = toggle(
      open.filter((s) => s !== 'feature'),
      'feature',
    );
  }

  // A tap on a cluster opens the cluster detail (v3 `+page.svelte:2494`), replacing any sheet.
  function openCluster(tap: ClusterTap): void {
    cluster = tap;
    open = toggle(close(open, 'cluster'), 'cluster');
  }
  $effect(() => ctx.map?.onClusterTap?.(openCluster));
  // A tap on empty map closes the detail, Neu and Zuletzt (v3 `handleMapClick`, `+page.svelte:2394`).
  $effect(() => ctx.map?.onMapTap(() => (open = afterMapTap(open, placing))));

  async function locate(): Promise<void> {
    clearTimeout(failedTimer);
    const ok = mapHandle !== undefined && !listShown && (await showStandort(mapHandle, position));
    locationFailed = !ok;
    if (!ok) failedTimer = setTimeout(() => (locationFailed = false), 5000);
  }

  /** A header button (desktop): Standort acts on the map, the + cycles like the bar's, the others toggle their sheet. */
  function pressHeader(item: BarItem | 'recent'): void {
    if (item === 'create' && formOpen) pickerShown = !pickerShown;
    else if (item === 'create') open = stepFab(open);
    else if (item === 'location') void locate();
    else open = toggle(open, item);
  }
  /** A bottom bar button (mobile): the same, except that the + cycles Neu, Neu with Zuletzt, closed. */
  function pressBar(item: BarItem): void {
    if (item !== 'create') pressHeader(item);
    else if (!formOpen) open = stepFab(open);
    else if (!pickerShown) pickerShown = true;
    else if (!open.includes('recent')) open = [...open, 'recent'];
    else [pickerShown, open] = [false, close(open, 'recent')]; // third press: picker and Zuletzt close, the form stays (v3 +page.svelte:258-272)
  }
  /** The + turns back as soon as the picker is closed, even while the form is open (v3 `workflowSelectorOpen`). */
  const fab = $derived(formOpen && !pickerShown && !open.includes('recent') ? 0 : fabStep(open));
  function skip(e: MouseEvent): void {
    e.preventDefault();
    mainEl?.focus();
  }
  // Neu left `open` another way (a new feature's detail replaces it): the flags go too, or the next + does nothing.
  $effect(() => {
    if (!open.includes('create')) [formOpen, pickerShown] = [false, false];
  });
</script>

<div class="app" style={HEADER_VARS}>
  <div class="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
    {#if device.identity.project.preview}<PreviewBanner {locale} />{/if}
    {#if notice}<NoticeBar {notice} {locale} />{/if}
    <ProblemBar {problems} {locale} />
    <!-- WCAG 2.4.1: invisible until focused; v3 had none, the header is short but the keyboard path needs it -->
    <a
      href="#ub-main"
      class="sr-only focus:not-sr-only focus:absolute focus:top-1 focus:left-1 {LAYER.skip} focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      onclick={skip}>{message(locale, 'skip')}</a
    >
    <Header
      {locale}
      title={device.identity.project.displayName}
      icon={iconUrl}
      syncing={syncProgress(syncStatus)}
      toolsActive={tools.length > 0}
      loading={mapIdle || shell.home === null ? undefined : message(locale, 'header_loading_objects')}
      {badge}
      onbutton={pressHeader}
    />
    <main id="ub-main" bind:this={mainEl} tabindex="-1" class="relative flex-1 overflow-hidden outline-none">
      {#if shell.home === null}
        <p role="status" class="p-4 text-sm text-muted-foreground">{message(locale, 'no_map')}</p>
      {:else if packsRead}
        {#key shell.home}
          <MapCanvas
            bind:this={canvas}
            {device}
            {filter}
            {layers}
            record={prefsClient}
            packProtocol={offline.offline.packProtocol}
            onPacksChange={(run) => onReadyPacksChange(offline.offline.manager, run)}
            viewKey={shell.home}
            {locale}
            onfeature={openFeature}
            selected={open.includes('feature') ? featureId : null}
            theme={shell.theme}
            onhandle={(h) => (mapHandle = h)}
            onlist={(shown) => (listShown = shown)}
            onidle={() => (mapIdle = true)}
          />
        {/key}
        {#if !mapIdle}
          <div
            class="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/50"
            data-testid="map-loading"
          >
            <div role="status" class="animate-pulse motion-reduce:animate-none text-muted-foreground">
              {message(locale, 'map_loading')}
            </div>
          </div>
        {/if}
      {/if}
      {#if locationFailed}
        <p
          role="status"
          class="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border bg-background px-3 py-2 text-sm shadow-md"
        >
          {message(locale, 'location_unavailable')}
        </p>
      {/if}
    </main>
  </div>

  <DownloadCard offline={offline.offline} {locale} />
  {#if !placing}
    <BottomBar {locale} toolsActive={tools.length > 0} {fab} {badge} onbutton={pressBar} />
  {/if}
  <SheetHost {open} {ctx} {featureId} {cluster} onclose={closeSlot} {registry} />
</div>

<style>
  .app {
    display: contents;
  }
</style>
