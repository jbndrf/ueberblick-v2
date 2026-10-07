<script lang="ts">
  // The `settings` slot: Einstellungen (v3 `SettingsSheet`), tabs Profil and Optionen. Everything it shows comes from
  // the device (queue, sync worker, clock); sign-out and the language go back to the screen (`ctx`). A row of the
  // pending-run list jumps to the Objekt: the feature sheet replaces this one.
  import { onMount, untrack } from 'svelte';
  import { resolveLabel } from '@ueberblick/ui';
  import { fieldLabelOf } from '../refusals';
  import SettingsSheet from '../sheets/settings/SettingsSheet.svelte';
  import OfflineTab from '../sheets/settings/offline/OfflineTab.svelte';
  import ToolSwitches from '../sheets/settings/tools/ToolSwitches.svelte';
  import type { SheetProps } from './sheets';

  let { ctx, onclose }: SheetProps = $props();
  const { device, locale } = $derived(ctx);

  // The features on the device, for the Einträge count of the Offline tab.
  let syncStatus = $state(untrack(() => device.sync.worker.status()));
  onMount(() => device.sync.worker.subscribe((s) => (syncStatus = s)));

  let open = $state(true);
  $effect(() => {
    if (!open) untrack(onclose);
  });

  const fieldLabel = $derived(fieldLabelOf(device.config.file, locale));
  const taskLabel = (key: string): string =>
    resolveLabel(device.config.file.tasks?.[key]?.label, locale, key);
  const roleLabel = (key: string): string =>
    resolveLabel(device.config.file.roles?.[key]?.label, locale, key);
</script>

<SettingsSheet
  bind:open
  {device}
  {locale}
  prefs={ctx.prefs}
  online={ctx.online}
  {taskLabel}
  {roleLabel}
  {fieldLabel}
  onjump={ctx.openFeature}
  onsignout={ctx.signOut}
  onlocale={ctx.setLocale}
  {tools}
  {offline}
/>

{#snippet offline()}
  <OfflineTab context={ctx.offline} {locale} records={syncStatus.featuresLoaded} />
{/snippet}

{#snippet tools()}
  <ToolSwitches entries={ctx.tools.entries} {locale} onswitch={ctx.tools.person.setSwitch} />
{/snippet}
