<script lang="ts">
  // Profil (v3 `SettingsSheet.svelte:401-514`): connection and sync card with the queue list, the participant card with
  // Abmelden, and the roles. Pure view: the parent feeds it from the device and receives the actions.
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import CircleHelp from '@lucide/svelte/icons/circle-help';
  import CloudUpload from '@lucide/svelte/icons/cloud-upload';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import LogOut from '@lucide/svelte/icons/log-out';
  import Shield from '@lucide/svelte/icons/shield';
  import User from '@lucide/svelte/icons/user';
  import Wifi from '@lucide/svelte/icons/wifi';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import type { FeatureId } from '@ueberblick/core/model';
  import { message, type Locale } from '../../messages';
  import type { Freshness } from '../../status';
  import type { PageEntry } from '../../info-pages/pages';
  import QueueList from './QueueList.svelte';
  import { openCount, type QueueRow } from './queue-rows';

  interface Props {
    locale: Locale;
    participant: {
      readonly id: string;
      readonly name: string;
      readonly roles: readonly string[];
      readonly email: string | null;
    };
    /** A role's label in the app language: the person sees the role as named in the project, never its key. */
    roleLabel: (roleKey: string) => string;
    /** The project's info pages (v3 lists them straight after the roles, without a heading). */
    infoPages: readonly PageEntry[];
    /** The instance's legal pages (empty: no heading). */
    legalPages: readonly PageEntry[];
    online: boolean;
    syncing: boolean;
    freshness: Freshness;
    hasSynced: boolean;
    syncError: string | undefined;
    rows: readonly QueueRow[];
    onsyncnow: () => void;
    onjump: (featureId: FeatureId) => void;
    onresend: (runId: string) => void;
    ondiscard: (runId: string) => void;
    onsignout: () => void;
    /** Abmelden found no network: the session stands. */
    signOutRefused?: boolean;
    onpage: (page: PageEntry) => void;
  }
  let {
    locale,
    participant,
    infoPages,
    legalPages,
    online,
    syncing,
    freshness,
    hasSynced,
    syncError,
    rows,
    onsyncnow,
    onjump,
    onresend,
    ondiscard,
    onsignout,
    signOutRefused = false,
    onpage,
    roleLabel,
  }: Props = $props();

  const unsent = $derived(openCount(rows)); // v3 `countOpenTaskRuns`: queued + sending
</script>

<div class="space-y-3">
  <div
    class="rounded-lg border p-3 {online
      ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950'
      : 'border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950'}"
    data-testid="sync-card"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        {#if online}
          <Wifi class="h-4 w-4 text-green-600 dark:text-green-400" />
          <span class="text-sm font-medium text-green-700 dark:text-green-300" role="status">
            {message(locale, 'settings_online')}
          </span>
        {:else}
          <WifiOff class="h-4 w-4 text-orange-600 dark:text-orange-400" />
          <span class="text-sm font-medium text-orange-700 dark:text-orange-300" role="status">
            {message(locale, 'settings_offline')}
          </span>
        {/if}
      </div>
      <Button variant="outline" size="sm" onclick={onsyncnow} disabled={syncing || !online}>
        {#if syncing}
          <Loader2 class="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none" />
          {message(locale, 'settings_syncing')}
        {:else}
          <CloudUpload class="mr-1 h-3 w-3" />
          {message(locale, 'settings_sync_now')}
        {/if}
      </Button>
    </div>
    <p class="mt-1 text-xs text-muted-foreground">
      {#if hasSynced && freshness.ago !== undefined}
        {message(locale, 'settings_last_synced', { ago: freshness.ago })}
      {:else}
        {message(locale, 'settings_never_synced')}
      {/if}
    </p>
    {#if freshness.staleDays !== undefined}
      <p class="mt-1 text-xs font-medium text-orange-700 dark:text-orange-300">
        {message(locale, 'settings_stale', { days: freshness.staleDays })}
      </p>
    {/if}
    {#if syncError !== undefined}
      <p class="mt-1 text-xs text-destructive">{syncError}</p>
    {:else if unsent > 0}
      <p class="mt-1 text-xs text-orange-700 dark:text-orange-300">
        {message(locale, 'settings_pending', { count: unsent })}
      </p>
    {:else}
      <p
        class="mt-1 text-xs {online
          ? 'text-green-700 dark:text-green-400'
          : 'text-orange-700 dark:text-orange-400'}"
      >
        {message(locale, online ? 'settings_no_changes' : 'settings_offline_queue')}
      </p>
    {/if}
    <QueueList {rows} {locale} {onjump} {onresend} {ondiscard} />
  </div>

  <div class="rounded-lg border bg-muted/50 p-3" data-testid="participant-card">
    <div class="flex items-center gap-2">
      <User class="h-4 w-4 text-muted-foreground" />
      <div>
        <div class="text-sm font-medium">{participant.name}</div>
        {#if participant.email !== null && participant.email !== ''}
          <div class="text-xs text-muted-foreground" data-testid="participant-email">{participant.email}</div>
        {/if}
      </div>
    </div>
    <Button variant="outline" size="sm" class="mt-2 w-full justify-start" onclick={onsignout}>
      <LogOut class="mr-2 h-4 w-4" />
      {message(locale, 'settings_logout')}
    </Button>
    {#if signOutRefused}
      <p class="mt-2 text-xs text-destructive" role="alert" data-testid="signout-offline">
        {message(locale, 'settings_logout_offline')}
      </p>
    {/if}
  </div>

  {#if participant.roles.length > 0}
    <div class="rounded-lg border bg-muted/50 p-3" data-testid="roles-card">
      <div class="mb-2 flex items-center gap-2 text-sm font-medium">
        <Shield class="h-4 w-4" />
        <span>{message(locale, 'settings_roles')}</span>
      </div>
      <div class="flex flex-wrap gap-1">
        {#each participant.roles as role (role)}
          <Badge variant="secondary">{roleLabel(role)}</Badge>
        {/each}
      </div>
    </div>
  {/if}

  {#each infoPages as entry (entry.id)}
    {@render pageButton(entry)}
  {/each}

  {#if legalPages.length > 0}
    <div class="pt-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
      {message(locale, 'settings_legal_heading')}
    </div>
    {#each legalPages as entry (entry.id)}
      {@render pageButton(entry)}
    {/each}
  {/if}
</div>

{#snippet pageButton(entry: PageEntry)}
  <button
    class="w-full rounded-lg border bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
    onclick={() => onpage(entry)}
  >
    <div class="flex items-center gap-2">
      <CircleHelp class="h-4 w-4 text-muted-foreground" />
      <span class="text-sm font-medium">{entry.title}</span>
    </div>
  </button>
{/snippet}
