<script lang="ts">
  // v3 `StagePreviewView.svelte:75-100` + `LibraryFieldsPalette.svelte`: the panel beside the preview that lists the
  // fields of the Objektart. A click (or a drag onto a tab) puts one at the end of the active Daten tab; fields already
  // in that tab are greyed out. v3's palette was English; it is German here.
  import Library from '@lucide/svelte/icons/library';
  import type { MessageKey, Translate } from '../../shell/messages';
  import type { HubField } from '../model/fields/hub';

  interface Props {
    t: Translate;
    fields: readonly HubField[];
    /** The keys already in the active tab. */
    used: ReadonlySet<string>;
    onpick: (key: string) => void;
    ongrab: (e: PointerEvent, key: string) => void;
  }
  let { t, fields, used, onpick, ongrab }: Props = $props();
</script>

<div class="palette" data-testid="stage-library">
  <div class="head">
    <Library size={14} />
    <span class="title">{t('stage_tab_library')}</span>
  </div>
  {#if fields.length === 0}
    <p class="empty">{t('stage_tab_library_empty')}</p>
  {:else}
    {#each fields as f (f.key)}
      {@const isUsed = used.has(f.key)}
      <button
        type="button"
        class="item"
        class:used={isUsed}
        disabled={isUsed}
        data-testid="stage-library-item"
        data-property={f.key}
        title={isUsed ? t('stage_tab_in_tab') : undefined}
        onpointerdown={(e) => !isUsed && ongrab(e, f.key)}
        onclick={() => onpick(f.key)}
      >
        <span class="label">{f.label}</span>
        <span class="meta">
          {t(`field_type_${f.type}` as MessageKey)}{#if f.hidden}
            · {t('stage_tab_hidden_field')}{/if}
        </span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    max-height: 40vh;
    overflow-y: auto;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--card);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding-bottom: 0.375rem;
    color: var(--muted-foreground);
  }
  .title {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.0625rem;
    min-height: 2.25rem;
    padding: 0.25rem 0.5rem;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
  }
  .item:hover:not(:disabled) {
    background: var(--accent);
  }
  .item.used {
    opacity: 0.45;
    cursor: default;
  }
  .label {
    font-size: 0.8125rem;
  }
  .meta {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .empty {
    margin: 0;
    padding: 0.5rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
</style>
