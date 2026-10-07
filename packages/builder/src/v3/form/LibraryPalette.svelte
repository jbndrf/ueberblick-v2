<script lang="ts">
  // v3 `form-editor/LibraryFieldsPalette.svelte`: the Feldbibliothek, the properties of the Objektart that the
  // form can take. A click or a drag adds one; the ones already in the form are greyed (v3 `usedDefIds`). Expanded it
  // shows the type and how many task forms use the property (v3 "n×"). v3's dot for the write mode (singleton,
  // observation, computed) is only there for a computed property: every other value is an observation here.
  import Library from '@lucide/svelte/icons/library';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import type { Translate } from '../../shell/messages';
  import type { MessageKey } from '../../shell/messages';
  import type { Drag } from './drag.svelte';
  import type { LibraryEntry } from './model';
  import { TYPE_ICONS } from './palette';

  interface Props {
    t: Translate;
    expanded: boolean;
    entries: readonly LibraryEntry[];
    drag: Drag;
    onadd: (key: string) => void;
  }
  let { t, expanded, entries, drag, onadd }: Props = $props();

  const meta = (e: LibraryEntry): string =>
    [t(`field_type_${e.type}` as MessageKey), t('form_library_usage', { count: e.usage })].join(' · ');
</script>

<section class="palette" class:expanded aria-label={t('form_library')} data-testid="form-library">
  <h4 class="header">
    <Library size={14} class="lib-icon" />
    <span class="title">{t('form_library')}</span>
  </h4>
  <div class="content">
    {#if entries.length === 0}
      {#if expanded}<p class="empty">{t('form_library_empty')}</p>{/if}
    {:else}
      {#each entries as e (e.key)}
        {@const Icon = TYPE_ICONS[e.type]}
        <button
          type="button"
          class="item"
          class:used={e.used}
          class:dragging={drag.active?.kind === 'property' && drag.active.key === e.key}
          data-testid={`library-${e.key}`}
          disabled={e.used}
          title={e.used ? `${e.label}: ${t('form_library_used')}` : expanded ? undefined : e.label}
          aria-label={expanded ? undefined : e.label}
          onpointerdown={(ev) => !e.used && drag.begin(ev, { kind: 'property', key: e.key })}
          onclick={() => onadd(e.key)}
        >
          <span class="type-icon"><Icon size={14} /></span>
          {#if expanded}
            <span class="info">
              <span class="name">{e.label}</span>
              <span class="meta">{meta(e)}</span>
            </span>
            {#if e.computed}
              <span class="computed" title={t('form_library_computed')}><Sparkles size={12} /></span>
            {/if}
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</section>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    width: 48px;
    max-height: 40vh;
    background: var(--card);
    border-bottom: 1px solid var(--border);
    overflow-x: hidden;
    overflow-y: auto;
    transition: width 0.2s ease;
  }
  .palette.expanded {
    width: 180px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin: 0;
    padding: 0.5rem;
    min-height: 2rem;
    border-bottom: 1px solid var(--border);
  }
  .header :global(.lib-icon) {
    flex-shrink: 0;
    color: var(--muted-foreground);
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
  .empty {
    margin: 0;
    padding: 0.5rem;
    font-size: 0.6875rem;
    text-align: center;
    color: var(--muted-foreground);
  }
  .item {
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
  .item:hover:not(.used) {
    background: var(--accent);
    border-color: var(--border);
  }
  .item.used {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .item.dragging {
    opacity: 0.5;
    border-color: var(--primary);
  }
  .type-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    color: var(--muted-foreground);
  }
  .info {
    display: flex;
    flex-direction: column;
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
  .meta {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .computed {
    display: flex;
    flex-shrink: 0;
    color: hsl(280 60% 60%);
  }
</style>
