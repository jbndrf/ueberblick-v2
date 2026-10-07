<script lang="ts">
  // v3's Cluster tab body (FilterSheet.svelte `clusterBody` :643-688): the switch "Gruppierung aufheben" with its
  // description, when on the "Bis zu" cap (min 1, step 50, default 500; a non-positive value is ignored) and the stats
  // line. The switch and the cap are the person's preferences (`tool_prefs.cluster.*`); the shell applies them to the
  // map (`MapScreen`), so they hold with this sheet closed. The stats come from the map's own cluster query.
  import { onMount, untrack } from 'svelte';
  import type { UnclusterStats } from '@ueberblick/ui';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { message, type Locale } from '../../../messages';
  import {
    clusterPrefs,
    parseCap,
    statsMessage,
    writeCap,
    writeUncluster,
    CLUSTER_TOOL,
    type ClusterPrefs,
  } from '../../../tools/cluster';
  import type { ToolPerson } from '../../../tools/person';

  interface Props {
    locale: Locale;
    person: Pick<ToolPerson, 'preferencesOf' | 'setPreference' | 'subscribe'>;
    /** The live map; none while the list stands in for it (then there are no stats). */
    map?:
      | {
          onUnclusterStats?: (listener: (stats: UnclusterStats) => void) => () => void;
        }
      | undefined;
  }
  let { locale, person, map }: Props = $props();

  const read = (): ClusterPrefs => clusterPrefs(person.preferencesOf(CLUSTER_TOOL));
  let prefs = $state(untrack(read));
  let stats = $state<UnclusterStats | undefined>();

  onMount(() => {
    const stopPerson = person.subscribe(() => (prefs = read()));
    const stopStats = map?.onUnclusterStats?.((s) => (stats = s));
    return () => {
      stopPerson();
      stopStats?.();
    };
  });

  function onCap(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cap = parseCap(input.value);
    if (cap === undefined)
      input.value = String(prefs.cap); // ignored, and the field shows the cap in force
    else writeCap(person, cap);
  }
  const line = $derived(statsMessage(prefs.uncluster ? stats : undefined));
</script>

<div class="space-y-3 px-1 py-6" data-cluster-tab>
  <div class="space-y-3 rounded-lg border p-3">
    <div class="flex items-center justify-between">
      <div class="min-w-0 flex-1 pr-3">
        <div class="text-sm font-medium">{message(locale, 'filter_cluster_switch')}</div>
        <div class="text-xs text-muted-foreground">{message(locale, 'filter_cluster_description')}</div>
      </div>
      <Switch
        checked={prefs.uncluster}
        aria-label={message(locale, 'filter_cluster_switch')}
        onCheckedChange={(on) => writeUncluster(person, on)}
      />
    </div>

    {#if prefs.uncluster}
      <div class="flex items-center justify-between gap-3">
        <label for="uncluster-cap" class="text-xs font-medium"
          >{message(locale, 'filter_cluster_cap_label')}</label
        >
        <Input
          id="uncluster-cap"
          type="number"
          min="1"
          step="50"
          class="h-8 w-24 text-right"
          value={prefs.cap}
          onchange={onCap}
        />
      </div>
      {#if line !== undefined}
        <div class="text-xs text-muted-foreground" data-cluster-stats role="status">
          {message(locale, line.key, { count: line.count })}
        </div>
      {/if}
    {/if}
  </div>
</div>
