<script lang="ts">
  // v3 `form-editor/FieldTypesPalette.svelte`: the Feldtypen. A tile creates a new field of that type (click or
  // tap, or drag it into the form). Collapsed it shows the icons (48 px), expanded the label and description.
  // v3 had the labels in English; they are translated here. The Smart Dropdown and the entity selector tiles place a
  // select with a choice filter and a reference to a table or a participant (WP-393).
  import type { Translate } from '../../shell/messages';
  import type { MessageKey } from '../../shell/messages';
  import type { Drag } from './drag.svelte';
  import { PALETTE_TILES, type PaletteTile } from './palette';

  interface Props {
    t: Translate;
    expanded: boolean;
    drag: Drag;
    onadd: (tile: PaletteTile) => void;
  }
  let { t, expanded, drag, onadd }: Props = $props();

  const label = (tile: PaletteTile): string => t(`form_tile_${tile.key}` as MessageKey);
  const description = (tile: PaletteTile): string => t(`form_tile_${tile.key}_desc` as MessageKey);
</script>

<section class="palette" class:expanded aria-label={t('form_types')} data-testid="form-types">
  <h4 class="header">
    <span class="title">{t('form_types')}</span>
  </h4>
  <div class="content">
    {#each PALETTE_TILES as tile (tile.key)}
      {@const Icon = tile.icon}
      <button
        type="button"
        class="tile"
        class:dragging={drag.active?.kind === 'tile' && drag.active.tile === tile.key}
        data-testid={`tile-${tile.key}`}
        title={expanded ? undefined : `${label(tile)}: ${description(tile)}`}
        aria-label={expanded ? undefined : label(tile)}
        onpointerdown={(e) => drag.begin(e, { kind: 'tile', tile: tile.key })}
        onclick={() => onadd(tile)}
      >
        <span class="icon"><Icon size={16} /></span>
        {#if expanded}
          <span class="info">
            <span class="name">{label(tile)}</span>
            <span class="desc">{description(tile)}</span>
          </span>
        {/if}
      </button>
    {/each}
  </div>
</section>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    width: 48px;
    background: var(--card);
    overflow-x: hidden;
    transition: width 0.2s ease;
  }
  .palette.expanded {
    width: 180px;
  }
  .header {
    display: flex;
    align-items: center;
    margin: 0;
    padding: 0.5rem;
    min-height: 2rem;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted-foreground);
    white-space: nowrap;
    overflow: hidden;
  }
  .palette:not(.expanded) .title {
    display: none;
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0.5rem;
  }
  .tile {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.375rem;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    cursor: grab;
    touch-action: pan-y;
    user-select: none;
    transition: all 0.15s ease;
  }
  .tile:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--border);
  }
  .tile:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .tile.dragging {
    opacity: 0.5;
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 10%, transparent);
  }
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    color: var(--muted-foreground);
    background: var(--muted);
    border-radius: 0.25rem;
  }
  .tile:hover:not(:disabled) .icon {
    color: var(--primary);
    background: color-mix(in oklab, var(--primary) 10%, transparent);
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
    flex: 1;
  }
  .name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .desc {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
