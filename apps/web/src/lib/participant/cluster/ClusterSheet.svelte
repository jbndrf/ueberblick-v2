<script lang="ts">
  // v3's cluster detail (`ClusterDetailModule.svelte`): the composition of a tapped cluster in the shared shell (peek
  // 35 vh, expanded 75 vh on a phone, the 450 px panel from 768 px). One block per Objektart, one row per stage with
  // its colour, count and share; a row is the drill-down (the map then shows only its members). Markup and classes are
  // v3's; the strings are German and English (v3's German catalogue still had English here).
  import { ModuleShell } from '@ueberblick/ui';
  import { message, type Locale } from '../messages';
  import type { ClusterGroup, ClusterRow } from './groups';

  interface Props {
    groups: readonly ClusterGroup[];
    totalCount: number;
    /** The row whose members the map shows alone (v3 `activeRowKey` and `activeWorkflowId`). */
    active: { readonly type: string; readonly key: string } | null;
    locale: Locale;
    onrow: (group: ClusterGroup, row: ClusterRow) => void;
    onclose: () => void;
  }
  let { groups, totalCount, active, locale, onrow, onclose }: Props = $props();
  let expanded = $state(false);
</script>

<ModuleShell
  open={true}
  bind:expanded
  title={message(locale, 'cluster_title', { count: totalCount })}
  subtitle={groups.length === 1
    ? message(locale, 'cluster_types_one')
    : message(locale, 'cluster_types', { count: groups.length })}
  toggleLabel={message(locale, 'cluster_toggle')}
  closeLabel={message(locale, 'cluster_close')}
  {onclose}
  peekVh={35}
  expandedVh={75}
  testid="cluster-sheet"
>
  <div class="flex flex-col gap-4 p-4">
    {#each groups as group, gi (group.type)}
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between px-1">
          <h4 class="text-sm font-semibold">{group.label}</h4>
          <span class="text-xs text-muted-foreground">{group.totalCount}</span>
        </div>

        {#each group.rows as row (row.key)}
          {@const on = active?.type === group.type && active.key === row.key}
          <button
            type="button"
            class="flex min-h-11 items-center gap-3 rounded-lg p-3 text-left transition-colors {on
              ? 'bg-primary/10 ring-1 ring-primary/30'
              : 'bg-muted/30 hover:bg-muted/50 active:bg-muted/70'}"
            aria-pressed={on}
            data-testid="cluster-row"
            onclick={() => onrow(group, row)}
          >
            <div class="h-4 w-4 shrink-0 rounded-full" style:background-color={row.color}></div>
            <div class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{row.label}</span>
              <span class="text-xs text-muted-foreground">
                {row.count === 1
                  ? message(locale, 'cluster_row_one')
                  : message(locale, 'cluster_row', { count: row.count })}
              </span>
            </div>
            <div class="w-20 shrink-0">
              <div class="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  style:width="{row.percentage}%"
                  style:background-color={row.color}
                ></div>
              </div>
            </div>
            <span class="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {row.percentage}%
            </span>
          </button>
        {/each}
      </div>

      {#if gi < groups.length - 1}
        <hr class="border-border" />
      {/if}
    {/each}
  </div>
</ModuleShell>
