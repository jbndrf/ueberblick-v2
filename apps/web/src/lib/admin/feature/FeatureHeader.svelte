<script lang="ts">
  // The page header (v3 `instances/[id]/+page.svelte:230-275`): "‹ Zurück", the name, and a grid of Stufe, Status,
  // Erstellt von, Erstellt am and Zuletzt geändert. The back link goes to the data page, whose table starts from the query it
  // was left with (`data/table-state.ts`).
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import { Badge } from '@ueberblick/ui/components/ui/badge';

  export interface HeaderField {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    readonly badge?: 'default' | 'secondary' | 'outline';
  }
  let {
    backHref,
    backLabel,
    typeLabel,
    name,
    fields,
  }: {
    backHref: string;
    backLabel: string;
    typeLabel: string;
    name: string;
    fields: readonly HeaderField[];
  } = $props();
</script>

<div class="space-y-3">
  <a
    href={backHref}
    data-testid="feature-back"
    class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
  >
    <ChevronLeft class="h-4 w-4" />
    {backLabel}
  </a>
  <div class="min-w-0">
    <h1 class="truncate text-xl font-semibold" data-testid="feature-title">{name}</h1>
    <p class="text-xs text-muted-foreground">{typeLabel}</p>
  </div>
  <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3" data-testid="feature-header">
    {#each fields as field (field.key)}
      <div class="min-w-0">
        <dt class="text-muted-foreground">{field.label}</dt>
        <dd class="font-medium break-words" data-testid="header-{field.key}">
          {#if field.badge}
            <Badge variant={field.badge}>{field.value}</Badge>
          {:else}
            {field.value}
          {/if}
        </dd>
      </div>
    {/each}
  </dl>
</div>
