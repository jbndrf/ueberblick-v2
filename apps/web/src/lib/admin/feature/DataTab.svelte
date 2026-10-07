<script lang="ts">
  // The Daten tab (v3 `instances/[id]/+page.svelte:336-390`): every property as "label: value", grouped by the tab the
  // admin gave it in the form (the general group first). Files are the table's file cell (thumbnails, lightbox).
  import type { PropertyRow } from '@ueberblick/ui';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import FileCell from '../data/FileCell.svelte';
  import type { DataGroup } from './model';

  let {
    groups,
    project,
    generalLabel,
    emptyText,
    noValue,
    onImage,
  }: {
    groups: readonly DataGroup[];
    project: string;
    generalLabel: string;
    emptyText: string;
    noValue: string;
    onImage: (url: string, name: string) => void;
  } = $props();

  const hasData = $derived(groups.some((g) => g.rows.some((r) => !r.empty)));
  const shown = (row: PropertyRow): string => (row.empty ? noValue : row.text);
</script>

{#if !hasData}
  <p class="py-8 text-center text-sm text-muted-foreground" data-testid="feature-data-empty">{emptyText}</p>
{:else}
  <div class="space-y-6" data-testid="feature-data">
    {#each groups as group (group.name ?? '')}
      <section class="space-y-2">
        <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {group.name ?? generalLabel}
        </h3>
        <dl class="divide-y divide-border rounded-lg border border-border">
          {#each group.rows as row (row.key)}
            <div class="flex justify-between gap-4 p-3 text-sm" data-testid="data-row-{row.key}">
              <dt class="text-muted-foreground">{row.label}</dt>
              <dd class="min-w-0 text-right font-medium break-words">
                {#if row.files.length > 0}
                  <div class="flex justify-end"><FileCell {project} value={row.files} {onImage} /></div>
                {:else if row.badges.length > 0}
                  <span class="flex flex-wrap justify-end gap-1">
                    {#each row.badges as badge (badge)}<Badge variant="secondary">{badge}</Badge>{/each}
                  </span>
                {:else}
                  <span class:whitespace-pre-wrap={row.multiline} class:text-muted-foreground={row.empty}>
                    {shown(row)}
                  </span>
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
{/if}
