<script lang="ts">
  // Einstellungen (v3 `SettingsSheet.svelte`): a right-hand sheet with the tabs Profil and Optionen. The Offline tab
  // (install, tile packs, Offline-Bilder) is step 5 and not here. Everything shown comes from the device: the queue,
  // the sync worker and the clock; nothing is fetched. Sign-out keeps unsent runs and asks first when some exist
  // (fixes v3 bug B3, where they were deleted).
  import { LAYER } from '../../layers';
  import { onMount, untrack, type Snippet } from 'svelte';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import * as Sheet from '@ueberblick/ui/components/ui/sheet';
  import * as Tabs from '@ueberblick/ui/components/ui/tabs';
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import User from '@lucide/svelte/icons/user';
  import type { SyncStatus } from '@ueberblick/client';
  import type { FeatureId, RunId } from '@ueberblick/core/model';
  import { message, type Locale } from '../../messages';
  import { freshness } from '../../status';
  import InfoPageDialog from '../../info-pages/InfoPageDialog.svelte';
  import { infoEntries, legalEntries, type PageEntry } from '../../info-pages/pages';
  import { readTab, writeTab } from './tab-memory';
  import OptionsTab from './OptionsTab.svelte';
  import ProfileTab from './ProfileTab.svelte';
  import { applyUiPrefs, type PrefsPort, type UiPrefs } from './prefs';
  import { hostFaultText } from '../../host-fault';
  import { queueRows, type QueueRow } from './queue-rows';
  import type { SettingsDevice } from './device';

  interface Props {
    open: boolean;
    device: SettingsDevice;
    locale: Locale;
    prefs: PrefsPort;
    online: boolean;
    taskLabel: (taskKey: string) => string;
    /** A role's label in the app language (the key when the template has none). */
    roleLabel: (roleKey: string) => string;
    /** The label of a task's field, for the "Feld: …" line of a refusal. */
    fieldLabel?: (taskKey: string, fieldKey: string) => string | undefined;
    /** Opens the Objekt's sheet on the map; the host closes this sheet. */
    onjump: (featureId: FeatureId) => void;
    /** Resolves true once signed out; false when it cannot be done now (offline): the session stands. */
    onsignout: () => Promise<boolean>;
    /** The person picked another language; the host re-renders in it. */
    onlocale: (locale: Locale) => void;
    /** The Werkzeuge switches (WP-613). */
    tools?: Snippet | undefined;
    /** The Offline tab (WP-650); until it lands the tab shows a plain notice. */
    offline?: Snippet;
  }
  let {
    open = $bindable(),
    device,
    locale,
    prefs,
    online,
    taskLabel,
    roleLabel,
    fieldLabel,
    onjump,
    onsignout,
    onlocale,
    tools,
    offline,
  }: Props = $props();

  const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
  let tab = $state<string>(readTab(storage));
  $effect(() => writeTab(storage, tab));
  let pageOpen = $state(false);
  let page: PageEntry | undefined = $state();
  const infoPages = $derived(infoEntries(device.identity, locale));
  const legalPages = $derived(legalEntries(device.identity));
  let syncStatus: SyncStatus = $state(untrack(() => device.sync.worker.status()));
  let rows: readonly QueueRow[] = $state([]);
  let syncing = $state(false);
  let syncError: string | undefined = $state();
  let hostFault = $state(
    hostFaultText(
      untrack(() => device.problems.list()),
      untrack(() => locale),
    ),
  );
  let confirmSignOut = $state(false);
  let signOutRefused = $state(false);
  let current: UiPrefs = $state(untrack(() => prefs.read()));
  let now = $state(Date.parse(untrack(() => device.clock.now())));

  let load = 0;
  async function reload(): Promise<void> {
    const mine = ++load;
    const runs = await device.store.readRuns();
    if (mine === load)
      rows = queueRows(
        runs,
        device.queue.status(),
        taskLabel,
        locale,
        fieldLabel,
        (id) => device.store.facts.feature(id) !== undefined,
      );
  }

  onMount(() => {
    void reload();
    const stops = [
      device.queue.subscribe(() => void reload()),
      device.changed.subscribe(() => void reload()),
      device.sync.worker.subscribe((s) => (syncStatus = s)),
      device.problems.subscribe((p) => (hostFault = hostFaultText(p, locale))),
    ];
    return () => stops.forEach((s) => s());
  });

  // The relative time and the stale warning are sampled when the sheet opens or a sync ends, not by a ticking timer.
  $effect(() => {
    if (open) {
      now = Date.parse(device.clock.now());
      void reload();
    }
  });

  const fresh = $derived(freshness(syncStatus.lastSyncedAt ?? null, now, locale));

  async function syncNow(): Promise<void> {
    syncing = true;
    syncError = undefined;
    try {
      await device.sync.syncNow();
    } catch (e) {
      syncError = e instanceof Error ? e.message : String(e);
    } finally {
      syncing = false;
      now = Date.parse(device.clock.now());
    }
  }

  const act = (op: () => Promise<unknown>) => async (): Promise<void> => {
    try {
      await op();
    } catch (e) {
      syncError = e instanceof Error ? e.message : String(e);
    }
    await reload();
  };

  function change(patch: Partial<UiPrefs>): void {
    prefs.write(patch);
    current = { ...current, ...patch };
    applyUiPrefs(document.documentElement, current);
    if (patch.locale !== undefined) onlocale(patch.locale);
  }

  function signOut(): void {
    if (rows.length > 0) confirmSignOut = true;
    else void finishSignOut();
  }
  async function finishSignOut(): Promise<void> {
    confirmSignOut = false;
    signOutRefused = false;
    if (await onsignout()) open = false;
    else signOutRefused = true;
  }
</script>

<Sheet.Root bind:open>
  <Sheet.ContentNoOverlay
    side="right"
    class="w-80 {LAYER.panel}"
    preventScroll={false}
    closeLabel={message(locale, 'feature_close')}
  >
    <Sheet.Header>
      <Sheet.Title>{message(locale, 'settings_title')}</Sheet.Title>
    </Sheet.Header>

    <Tabs.Root bind:value={tab} class="mt-2 flex flex-1 flex-col overflow-hidden">
      <Tabs.List class="w-full shrink-0">
        <Tabs.Trigger value="profile">
          <User class="h-4 w-4" />
          <span>{message(locale, 'settings_tab_profile')}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="options">
          <SlidersHorizontal class="h-4 w-4" />
          <span>{message(locale, 'settings_tab_options')}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="offline">
          <HardDrive class="h-4 w-4" />
          <span>{message(locale, 'settings_tab_offline')}</span>
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="profile" class="overflow-y-auto py-4 pr-1">
        <ProfileTab
          {locale}
          participant={device.participant}
          {roleLabel}
          {infoPages}
          {legalPages}
          onpage={(entry) => {
            page = entry;
            pageOpen = true;
          }}
          {online}
          {syncing}
          freshness={fresh}
          hasSynced={syncStatus.lastSyncedAt !== undefined}
          syncError={syncError ??
            hostFault ??
            (syncStatus.lastError?.kind === 'transport' ? undefined : syncStatus.lastError?.message)}
          {rows}
          onsyncnow={() => void syncNow()}
          onjump={(id) => {
            open = false;
            onjump(id);
          }}
          onresend={(id) => void act(() => device.queue.resubmit(id as RunId))()}
          ondiscard={(id) => void act(() => device.queue.discard(id as RunId))()}
          onsignout={signOut}
          {signOutRefused}
        />
      </Tabs.Content>

      <Tabs.Content value="options" class="overflow-y-auto py-4 pr-1">
        <OptionsTab prefs={current} {locale} onchange={change} {tools} />
      </Tabs.Content>

      <Tabs.Content value="offline" class="overflow-y-auto py-4 pr-1">
        {#if offline}
          {@render offline()}
        {:else}
          <p class="text-sm text-muted-foreground" data-testid="offline-pending">
            {message(locale, 'settings_offline_pending')}
          </p>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  </Sheet.ContentNoOverlay>
</Sheet.Root>

<InfoPageDialog bind:open={pageOpen} {locale} {page} login={device.identity.login} />

<AlertDialog.Root bind:open={confirmSignOut}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{message(locale, 'signout_title')}</AlertDialog.Title>
      <AlertDialog.Description>
        {message(locale, 'signout_body', { count: rows.length })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{message(locale, 'signout_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => void finishSignOut()}
        >{message(locale, 'signout_confirm')}</AlertDialog.Action
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
