<script lang="ts">
  // One property of the active Daten tab (v3 `FormPreview` card): clicking it opens its Felddefinition; its grip drags
  // it (the form editor's drag, `form/drag.svelte.ts`, R1) and, in a tab the admin made, a button sends it back to
  // "Daten" ("Aus Tab entfernen").
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Lock from '@lucide/svelte/icons/lock';
  import X from '@lucide/svelte/icons/x';
  import type { Translate } from '../../shell/messages';

  interface Props {
    t: Translate;
    key: string;
    label: string;
    /** A role is chosen and cannot see the property. */
    dimmed: boolean;
    /** A role is chosen and may not write it. */
    readonly: boolean;
    visible: boolean;
    editable: boolean;
    byRole: boolean;
    /** A single card in its line: another card can be dropped beside it (the form editor's squeeze). */
    squeeze: boolean;
    removable: boolean;
    dragging: boolean;
    onselect: (key: string) => void;
    onremove: () => void;
    ongrip: (e: PointerEvent) => void;
  }
  let {
    t,
    key,
    label,
    dimmed,
    readonly,
    visible,
    editable,
    byRole,
    squeeze,
    removable,
    dragging,
    onselect,
    onremove,
    ongrip,
  }: Props = $props();
</script>

<li class="cell" class:dragging data-squeeze={squeeze ? key : undefined}>
  <button
    type="button"
    class="field"
    class:hidden={dimmed}
    data-testid="stage-property"
    data-property={key}
    data-visible={visible}
    data-editable={editable}
    title={dimmed ? t('stage_hidden') : ''}
    onclick={() => onselect(key)}
  >
    <span class="name">{label}</span>
    {#if dimmed}
      <EyeOff class="mark" aria-label={t('stage_hidden')} />
    {:else if byRole && readonly}
      <span class="ro"><Lock class="mark" />{t('stage_readonly')}</span>
    {/if}
  </button>
  <div class="tools">
    <button
      type="button"
      class="tool grip"
      data-testid="stage-grip"
      aria-label={t('form_card_drag')}
      title={t('form_card_drag')}
      onpointerdown={(e) => {
        e.stopPropagation();
        ongrip(e);
      }}
      onclick={(e) => e.stopPropagation()}
    >
      <GripVertical size={14} />
    </button>
    {#if removable}
      <button
        type="button"
        class="tool"
        data-testid="stage-remove-from-tab"
        title={t('stage_tab_remove_field')}
        aria-label={t('stage_tab_remove_field')}
        onclick={onremove}><X size={12} /></button
      >
    {/if}
  </div>
</li>

<style>
  .cell {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .cell.dragging {
    opacity: 0.5;
  }
  .field {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    min-height: 2.25rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--card);
    color: var(--foreground);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
  }
  .field:hover {
    background: var(--accent);
  }
  .field.hidden {
    opacity: 0.45;
    border-style: dashed;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ro {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .field :global(.mark) {
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }
  .tool {
    min-width: 2rem;
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.6875rem;
    cursor: pointer;
  }
  .grip {
    cursor: grab;
    touch-action: none;
  }
  .tool:hover {
    background: var(--accent);
    color: var(--foreground);
  }
</style>
