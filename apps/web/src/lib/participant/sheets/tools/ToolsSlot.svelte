<script lang="ts">
  // The `tools` slot: Werkzeuge (v3 `ToolsSheet`) over the tools this person has on. A tile closes the sheet and opens
  // the tool's panel (v3 `handleOpenChat`; the chat is the shell's own slot): Measure above the map without a scrim, Search in a sheet. The panel closes
  // the whole slot. A tool may start a task; the form opens as from a feature, with no feature (a creating task).
  // While the list stands in for the map (`ctx.map` is undefined) the tools that need a tappable map are not offered.
  import { untrack } from 'svelte';
  import type { FeatureId } from '@ueberblick/core/model';
  import { deriveShellModel, THEMES } from '@ueberblick/ui';
  import FormShell from '../../form/FormShell.svelte';
  import { mapToolPort } from '../../map-view';
  import type { SheetProps } from '../../shell/sheets';
  import ToolPanel from '../../ToolPanel.svelte';
  import { manifestOf } from '../../tools/manifest';
  import { sheetTools } from '../../tools/entries';
  import { toolName } from '../../tools/labels';
  import ToolsSheet, { type Tile } from './ToolsSheet.svelte';

  let { ctx, onclose }: SheetProps = $props();
  const { device, locale } = $derived(ctx);

  let open = $state(true);
  let active: string | null = $state(null);
  let startedTask: string | null = $state(null);

  // A tile of a side-panel tool (the chat, v3 `onOpenChat`) closes this sheet and asks the shell for the panel, which
  // is its own slot and stays open under the other sheets; any other tool opens its panel in this slot.
  function pick(key: string): void {
    if (manifestOf(key)?.aside) ctx.openChat();
    else active = key;
  }

  // The sheet closes itself (its X, a tap outside) and opens a tool: only the first ends the slot.
  $effect(() => {
    if (!open && active === null) untrack(onclose);
  });

  // What the tools report (v3: the chat tile's red count or grey dot), counted on the device.
  let badges = $state(untrack(() => device.toolBadges.current()));
  $effect(() => device.toolBadges.subscribe(() => (badges = device.toolBadges.current())));

  const tiles = $derived<readonly Tile[]>(
    sheetTools(ctx.tools.entries, device.problems.list(), { map: ctx.map !== undefined }).map((t) => ({
      key: t.key,
      label: toolName(locale, t.key),
      icon: t.icon,
      ...(badges[t.key] === undefined ? {} : { badge: badges[t.key] }),
    })),
  );

  // The overlay of a tool in the role's theme colour, as the Standort dot.
  const color = $derived(
    THEMES[deriveShellModel({ file: device.config.file, roleKey: device.roleKey ?? '', locale }).theme].color
      .primary,
  );
  // the handle alone, not `ctx`: ctx is rebuilt on every sheet change, and a new port would remount the open tool
  const handle = $derived(ctx.map);
  const port = $derived(mapToolPort(handle, { color }).port);

  function openFeature(id: FeatureId): void {
    ctx.openFeature(id);
    onclose();
  }
</script>

<ToolsSheet bind:open {tiles} {locale} onopen={pick} />

{#if active !== null && startedTask === null}
  <ToolPanel
    {device}
    toolKey={active}
    label={toolName(locale, active)}
    {locale}
    map={port}
    person={ctx.tools.person}
    onstartTask={(key) => (startedTask = key)}
    onopenFeature={openFeature}
    {onclose}
  />
{/if}

{#if startedTask !== null}
  <!-- a creating task started from a tool: the form in the shared detail shell, with no feature -->
  <FormShell
    {device}
    taskKey={startedTask}
    featureIds={[]}
    {locale}
    online={ctx.online}
    center={ctx.center}
    {onclose}
  />
{/if}
