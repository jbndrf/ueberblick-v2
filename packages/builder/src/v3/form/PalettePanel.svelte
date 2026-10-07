<script lang="ts">
  // The left panel of the form editor (v3 `FormEditorView.svelte:441-502`): the chevron on the edge, Feldbibliothek
  // and Feldtypen. Collapsed to icons (68 px) or expanded (200 px); on a phone the expanded panel overlays the preview.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Link2 from '@lucide/svelte/icons/link-2';
  import type { Translate } from '../../shell/messages';
  import type { Drag } from './drag.svelte';
  import LibraryPalette from './LibraryPalette.svelte';
  import type { LibraryEntry } from './model';
  import type { PaletteTile } from './palette';
  import TypesPalette from './TypesPalette.svelte';

  interface Props {
    t: Translate;
    expanded: boolean;
    library: readonly LibraryEntry[];
    drag: Drag;
    onaddproperty: (key: string) => void;
    onaddtile: (tile: PaletteTile) => void;
    /** v3 `builderRelatedAddButton`: opens the picker of a field of a linked Objekt. */
    onlinked: () => void;
  }
  let { t, expanded = $bindable(), library, drag, onaddproperty, onaddtile, onlinked }: Props = $props();
</script>

<div class="left" class:expanded data-testid="form-palettes" role="group" aria-label={t('form_palettes')}>
  <button
    type="button"
    class="toggle"
    data-testid="palette-toggle"
    aria-expanded={expanded}
    aria-label={expanded ? t('form_palette_collapse') : t('form_palette_expand')}
    title={expanded ? t('form_palette_collapse') : t('form_palette_expand')}
    onclick={() => (expanded = !expanded)}
  >
    {#if expanded}<ChevronRight size={16} />{:else}<ChevronLeft size={16} />{/if}
  </button>
  <div class="stack">
    <LibraryPalette {t} {expanded} entries={library} {drag} onadd={onaddproperty} />
    <TypesPalette {t} {expanded} {drag} onadd={onaddtile} />
    <button
      type="button"
      class="linked"
      class:expanded
      data-testid="linked-add"
      title={t('form_linked_add')}
      aria-label={expanded ? undefined : t('form_linked_add')}
      onclick={onlinked}
    >
      <Link2 size={16} />
      {#if expanded}<span class="linked-label">{t('form_linked_add')}</span>{/if}
    </button>
  </div>
</div>

<style>
  .left {
    display: flex;
    flex-shrink: 0;
    width: 68px;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--card);
    transition: width 0.2s ease;
  }
  .left.expanded {
    width: 200px;
  }
  @container (max-width: 499px) {
    .left.expanded {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 5;
      box-shadow: 4px 0 16px oklch(0 0 0 / 0.15);
    }
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    padding: 0;
    color: var(--muted-foreground);
    background: var(--muted);
    border: none;
    border-right: 1px solid var(--border);
    cursor: pointer;
  }
  .toggle:hover {
    color: var(--primary);
    background: var(--accent);
  }
  .linked {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    margin: 0.5rem;
    padding: 0.5rem;
    color: var(--muted-foreground);
    cursor: pointer;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
    transition: all 0.15s ease;
  }
  .linked.expanded {
    justify-content: flex-start;
  }
  .linked:hover {
    color: var(--primary);
    background: var(--accent);
    border-color: color-mix(in oklab, var(--primary) 50%, transparent);
  }
  .linked-label {
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
  }
  .stack {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
  }
</style>
