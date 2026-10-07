<script lang="ts">
  // The tool switches in Einstellungen -> Optionen (v3 `AdvancedFeaturesPanel.svelte`, "Advanced features"): a
  // collapsible box with a count of what is on, an intro and one switch per tool, grouped by where the tool plugs in
  // (v3: Filter sheet, Layer sheet, Map tools; here the contribution points). Rows are the tools the role offers or
  // has on; a switch is the person's own choice, kept in the preference record (`tools.<key>`). Nothing here knows a
  // tool: names come from the catalogue, groups from the manifest's contribution points.
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { message, type Locale, type MessageKey } from '../../../messages';
  import {
    groupOf,
    switchableTools,
    TOOL_GROUPS,
    type ToolEntry,
    type ToolGroup,
  } from '../../../tools/entries';
  import { toolDescription, toolName } from '../../../tools/labels';

  interface Props {
    entries: readonly ToolEntry[];
    locale: Locale;
    onswitch: (toolKey: string, on: boolean) => void;
  }
  let { entries, locale, onswitch }: Props = $props();

  const GROUP_TEXT = {
    filter: 'settings_advanced_group_filter',
    layers: 'settings_advanced_group_layers',
    tools: 'settings_advanced_group_tools',
  } as const satisfies Record<ToolGroup, MessageKey>;

  let expanded = $state(false);
  const rows = $derived(switchableTools(entries));
  const onCount = $derived(rows.filter((t) => t.on).length);
  const groups = $derived(
    TOOL_GROUPS.map((group) => ({
      group,
      tools: rows.filter((t) => t.contributes.some((c) => groupOf(c) === group)),
    })).filter((g) => g.tools.length > 0),
  );
</script>

{#if rows.length > 0}
  <div class="rounded-md border">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <div class="flex items-center gap-2">
        <Sparkles class="h-4 w-4 text-muted-foreground" />
        <span class="text-sm font-medium">{message(locale, 'settings_advanced_title')}</span>
        {#if onCount > 0}
          <Badge variant="secondary" class="text-xs">{onCount}</Badge>
        {/if}
      </div>
      {#if expanded}
        <ChevronDown class="h-4 w-4 text-muted-foreground" />
      {:else}
        <ChevronRight class="h-4 w-4 text-muted-foreground" />
      {/if}
    </button>

    {#if expanded}
      <div class="space-y-4 border-t p-3">
        <p class="text-xs text-muted-foreground">{message(locale, 'settings_advanced_intro')}</p>

        {#each groups as { group, tools } (group)}
          <div class="space-y-2">
            <h3 class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {message(locale, GROUP_TEXT[group])}
            </h3>
            <div class="space-y-1.5">
              {#each tools as tool (tool.key)}
                <div class="flex items-start justify-between gap-3 rounded px-2 py-1.5">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="text-sm">{toolName(locale, tool.key)}</span>
                    </div>
                    <div class="text-xs text-muted-foreground">{toolDescription(locale, tool.key)}</div>
                  </div>
                  <Switch
                    checked={tool.on}
                    aria-label={toolName(locale, tool.key)}
                    onCheckedChange={(on) => onswitch(tool.key, on)}
                  />
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
