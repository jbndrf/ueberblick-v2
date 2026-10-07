<script lang="ts">
  // Phone (below 768 px, WP-345): the catalog and the inspector of the desktop frame open as sheets over
  // the full-width canvas, the way v3's admin sidebar does (`sidebar.svelte` mobile branch).
  // `preventScroll={false}`: the scroll lock sets `pointer-events: none` on the body, which would make the
  // body-level dialogs of the inspector (the kit MultiSelect of the role pickers) unclickable.
  import type { Snippet } from 'svelte';
  import Save from '@lucide/svelte/icons/save';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Sheet from '@ueberblick/ui/components/ui/sheet';
  import type { Translate } from '../../shell/messages';

  interface Props {
    t: Translate;
    catalogOpen: boolean;
    inspectorOpen: boolean;
    catalog: Snippet;
    inspector: Snippet;
    /** The toolbar's Speichern, repeated in the sheets: v3 had no sheets, its toolbar was always in view. */
    saving: boolean;
    canSave: boolean;
    onsave: () => void;
  }
  let {
    t,
    saving,
    canSave,
    onsave,
    catalogOpen = $bindable(),
    inspectorOpen = $bindable(),
    catalog,
    inspector,
  }: Props = $props();

  /** A tap on a dialog the inspector opened (the role pickers portal to the body) is not a tap outside the sheet. */
  function keepForDialogs(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[data-slot="sheet-overlay"]') === null) {
      event.preventDefault();
    }
  }
</script>

{#snippet saveBar()}
  <div class="sheet-save">
    <Button size="sm" data-testid="sheet-save" onclick={onsave} disabled={saving || !canSave}>
      {#if saving}
        <LoaderCircle class="animate-spin" />
        {t('frame_saving')}
      {:else}
        <Save />
        {t('frame_save')}
      {/if}
    </Button>
  </div>
{/snippet}

<Sheet.Root bind:open={catalogOpen}>
  <Sheet.Content side="left" class="sheet-pane catalog-sheet" preventScroll={false}>
    <Sheet.Header class="sr-only">
      <Sheet.Title>{t('catalog_label')}</Sheet.Title>
      <Sheet.Description>{t('catalog_label')}</Sheet.Description>
    </Sheet.Header>
    {@render saveBar()}
    {@render catalog()}
  </Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={inspectorOpen}>
  <Sheet.Content
    side="bottom"
    class="sheet-pane inspector-sheet"
    preventScroll={false}
    onInteractOutside={keepForDialogs}
  >
    <Sheet.Header class="sr-only">
      <Sheet.Title>{t('frame_inspector')}</Sheet.Title>
      <Sheet.Description>{t('frame_inspector')}</Sheet.Description>
    </Sheet.Header>
    {@render saveBar()}
    {@render inspector()}
  </Sheet.Content>
</Sheet.Root>

<style>
  :global(.sheet-pane) {
    padding: 0;
    gap: 0;
    overflow: hidden;
  }
  :global(.sheet-save) {
    display: flex;
    justify-content: flex-end;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    /* clear of the sheet's close button in the corner */
    padding-right: 3rem;
  }
  :global(.catalog-sheet) {
    width: min(20rem, 85vw);
  }
  :global(.inspector-sheet) {
    max-height: 85dvh;
    min-height: 40dvh;
  }
  :global(.catalog-sheet .catalog.catalog) {
    width: 100%;
    border-right: none;
    flex: 1;
  }
  :global(.inspector-sheet .inspector.inspector) {
    width: 100%;
    border-left: none;
    flex: 1;
    min-height: 0;
  }
</style>
