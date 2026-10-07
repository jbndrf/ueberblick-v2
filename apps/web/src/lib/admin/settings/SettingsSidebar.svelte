<script lang="ts">
  import type { SidebarGroup } from './sidebar-types';
  // The section sidebar of the settings page (v3 `settings/SettingsSidebar.svelte:32-81`): group captions, one button
  // per section with icon, label and status dot, the active one highlighted (`aria-current`), the destructive tone for
  // the danger zone. A column above the content on a phone, `md:w-56` beside it on a computer.
  let {
    groups,
    current,
    label,
    onSelect,
  }: {
    groups: readonly SidebarGroup[];
    current: string;
    /** The nav's accessible name. */
    label: string;
    onSelect: (id: string) => void;
  } = $props();
</script>

<nav class="flex w-full flex-col gap-4 md:w-56" aria-label={label} data-testid="settings-sidebar">
  {#each groups as group (group.caption)}
    <div class="space-y-1">
      <div class="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {group.caption}
      </div>
      <ul class="space-y-0.5">
        {#each group.items as item (item.id)}
          {@const active = item.id === current}
          {@const destructive = item.tone === 'destructive'}
          <li>
            <button
              type="button"
              onclick={() => onSelect(item.id)}
              aria-current={active ? 'page' : undefined}
              data-section={item.id}
              class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors {active
                ? destructive
                  ? 'bg-destructive/10 font-medium text-destructive'
                  : 'bg-accent font-medium text-accent-foreground'
                : destructive
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'hover:bg-accent/50'}"
            >
              {#if item.icon}
                {@const Icon = item.icon}
                <Icon class="h-4 w-4 shrink-0 {destructive ? 'text-destructive' : 'text-muted-foreground'}" />
              {/if}
              <span class="flex-1 truncate">{item.label}</span>
              {#if item.status === 'on'}
                <span class="h-2 w-2 shrink-0 rounded-full bg-primary" data-status="on" aria-hidden="true"
                ></span>
              {:else if item.status === 'off'}
                <span
                  class="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40"
                  data-status="off"
                  aria-hidden="true"
                ></span>
              {:else if item.status === 'unavailable'}
                <span
                  class="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30 opacity-40"
                  data-status="unavailable"
                  aria-hidden="true"
                ></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</nav>
