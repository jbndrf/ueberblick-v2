<script lang="ts">
  // v3's Ansichten tab (FilterSheet.svelte:477-613): "Standard" plus the person's saved views (pick, rename, delete,
  // "Neue Ansicht"), exactly one active, and "Vom Projekt". Owner answer Q20 (better than v3's "Laden", which
  // copied the project's view into a personal one): a project preset is picked directly, like a saved view, and
  // replaces the switches while it is active. The filter builder under the active saved view is a seam (`builder`).
  import type { Snippet } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Separator } from '@ueberblick/ui/components/ui/separator';
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import Check from '@lucide/svelte/icons/check';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import { message, type Locale } from '../../messages';
  import type { ActiveView } from './filter-controller';
  import type { FilterViews } from './filter-views';

  interface Props {
    views: FilterViews;
    active: ActiveView | null;
    locale: Locale;
    onselect: (view: ActiveView | null) => void;
    /** The filter builder for the active saved view (behind tool availability, WP-613; nothing here yet). */
    builder?: Snippet<[ActiveView]> | undefined;
  }
  let { views, active, locale, onselect, builder }: Props = $props();

  let creating = $state(false);
  let newName = $state('');
  let editingId = $state<string | null>(null);
  let editingName = $state('');

  const isActive = (kind: ActiveView['kind'], key: string): boolean =>
    active?.kind === kind && active.key === key;

  function commitNew(): void {
    const name = newName.trim();
    if (name === '') return;
    views.save?.(name);
    newName = '';
    creating = false;
  }
  function cancelNew(): void {
    newName = '';
    creating = false;
  }
  function commitRename(): void {
    const name = editingName.trim();
    if (editingId !== null && name !== '') views.rename?.(editingId, name);
    editingId = null;
    editingName = '';
  }
  function cancelRename(): void {
    editingId = null;
    editingName = '';
  }
</script>

{#snippet radio(on: boolean)}
  <div
    class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 {on
      ? 'border-primary bg-primary'
      : 'border-muted-foreground/50'}"
  >
    {#if on}<div class="h-1.5 w-1.5 rounded-full bg-primary-foreground"></div>{/if}
  </div>
{/snippet}

<div class="space-y-5 px-4 py-6">
  <div class="space-y-2">
    <h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {message(locale, 'filter_views_header')}
    </h3>

    <button
      type="button"
      role="radio"
      aria-checked={active === null}
      class="flex w-full items-center gap-2 rounded-md border p-3 text-left transition-colors hover:bg-accent/50 {active ===
      null
        ? 'border-primary bg-primary/5'
        : ''}"
      onclick={() => active !== null && onselect(null)}
    >
      {@render radio(active === null)}
      <span class="flex-1 truncate text-sm font-medium">{message(locale, 'filter_default_view')}</span>
    </button>

    {#each views.saved ?? [] as view (view.id)}
      {@const on = isActive('saved', view.id)}
      <div class="flex items-center gap-2 rounded-md border p-2 {on ? 'border-primary bg-primary/5' : ''}">
        {#if editingId === view.id}
          <Input
            type="text"
            class="h-7 flex-1"
            aria-label={message(locale, 'filter_view_rename')}
            bind:value={editingName}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') cancelRename();
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7"
            aria-label={message(locale, 'filter_view_save')}
            onclick={commitRename}><Check class="h-3.5 w-3.5" /></Button
          >
          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7"
            aria-label={message(locale, 'filter_view_cancel')}
            onclick={cancelRename}><X class="h-3.5 w-3.5" /></Button
          >
        {:else}
          <button
            type="button"
            role="radio"
            aria-checked={on}
            class="flex min-w-0 flex-1 items-center gap-2 text-left"
            onclick={() => onselect(on ? null : { kind: 'saved', key: view.id })}
          >
            {@render radio(on)}
            <Bookmark class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate text-sm font-medium">{view.name}</span>
          </button>
          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7 shrink-0"
            title={message(locale, 'filter_view_rename')}
            aria-label={message(locale, 'filter_view_rename')}
            onclick={() => {
              editingId = view.id;
              editingName = view.name;
            }}><Pencil class="h-3.5 w-3.5" /></Button
          >
          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7 shrink-0"
            title={message(locale, 'filter_view_delete')}
            aria-label={message(locale, 'filter_view_delete')}
            onclick={() => views.remove?.(view.id)}><Trash2 class="h-3.5 w-3.5" /></Button
          >
        {/if}
      </div>
    {/each}

    {#if views.save !== undefined}
      {#if creating}
        <div class="flex items-center gap-2">
          <Input
            type="text"
            class="h-8 flex-1"
            placeholder={message(locale, 'filter_view_name_placeholder')}
            aria-label={message(locale, 'filter_view_name_placeholder')}
            bind:value={newName}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNew();
              } else if (e.key === 'Escape') cancelNew();
            }}
          />
          <Button size="sm" onclick={commitNew} disabled={newName.trim() === ''}>
            {message(locale, 'filter_view_save')}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            aria-label={message(locale, 'filter_view_cancel')}
            onclick={cancelNew}><X class="h-4 w-4" /></Button
          >
        </div>
      {:else}
        <Button
          variant="outline"
          size="sm"
          class="w-full justify-start"
          onclick={() => {
            creating = true;
            newName = '';
          }}
        >
          <Plus class="mr-2 h-4 w-4" />
          {message(locale, 'filter_new_view')}
        </Button>
      {/if}
    {/if}

    {#if views.presets.length > 0}
      <Separator class="my-2" />
      <div class="flex flex-col gap-1">
        <div class="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {message(locale, 'filter_presets_header')}
        </div>
        {#each views.presets as preset (preset.key)}
          {@const on = isActive('preset', preset.key)}
          <button
            type="button"
            role="radio"
            aria-checked={on}
            class="flex items-center gap-2 rounded-md border border-dashed p-2 text-left transition-colors hover:bg-accent/50 {on
              ? 'border-primary bg-primary/5'
              : ''}"
            onclick={() => onselect(on ? null : { kind: 'preset', key: preset.key })}
          >
            {@render radio(on)}
            <Bookmark class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-sm">{preset.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if active?.kind === 'saved' && builder !== undefined}
    <Separator />
    {@render builder(active)}
  {/if}
</div>
