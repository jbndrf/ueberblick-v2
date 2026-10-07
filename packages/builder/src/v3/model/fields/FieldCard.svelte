<script lang="ts">
  // v3 `FieldHub.svelte:263-296` (`field-card`): one field. Clicking it opens the Felddefinition (the one editor);
  // the buttons hide it from the Daten tabs or bring it back from the library, and delete it entirely (v3 had that on
  // right-click, which a phone does not have). Added to v3's card (WP-378): the required star, the key and where the
  // field is used (tasks and rules).
  import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Move from '@lucide/svelte/icons/move';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { MessageKey, Translate } from '../../../shell/messages';
  import type { HubField } from './hub';
  import type { Arrange } from './layout-ops';

  interface Props {
    field: HubField;
    t: Translate;
    selected: boolean;
    dragging: boolean;
    /** The names of the tasks and rules that use the field, for the tooltip. */
    usedNames: string;
    deletable: boolean;
    onselect: () => void;
    ontoggle: () => void;
    ondelete: () => void;
    /** `onpointerdown` of the grip: starts the form editor's drag (`form/drag.svelte.ts`, R1). */
    ongrip: (e: PointerEvent) => void;
    /** A single card in its line: another card can be dropped beside it. */
    squeeze?: boolean;
    /** Drawn as half or full width inside a layout row. */
    layout?: boolean;
    /** What drag cannot say: the full-width position and the tab, as selects. */
    arrange?: Arrange | undefined;
  }
  let {
    field,
    t,
    selected,
    dragging,
    usedNames,
    deletable,
    onselect,
    ontoggle,
    ondelete,
    ongrip,
    squeeze = false,
    layout = false,
    arrange,
  }: Props = $props();

  const MODES: Record<HubField['writeMode'], MessageKey> = {
    single: 'fh_mode_single',
    observation: 'fh_mode_observation',
    computed: 'fh_mode_computed',
  };
  /** The `<option>` value of the library (a name no Daten tab can have). */
  const HIDDEN_VALUE = ' hidden';
  const used = $derived(field.usedIn.tasks.length + field.usedIn.rules.length);
</script>

<div
  class="field-card"
  class:layout
  class:selected
  class:dragging
  data-field={field.key}
  data-squeeze={squeeze ? field.key : undefined}
>
  <button
    type="button"
    class="icon-btn grip"
    data-testid="field-grip"
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
  <button
    type="button"
    class="card-main"
    aria-label={t('fh_open', { name: field.label })}
    aria-current={selected ? 'true' : undefined}
    onclick={onselect}
  >
    <span class="card-label">
      {field.label}
      {#if field.required}<span class="star" title={t('field_required')}>*</span>{/if}
    </span>
    <span class="card-meta">{t(`field_type_${field.type}` as MessageKey)} · {t(MODES[field.writeMode])}</span>
    <span class="card-meta">
      <code title={t('fh_key', { key: field.key })}>{field.key}</code>
      ·
      <span title={used > 0 ? t('fh_used_title', { names: usedNames }) : undefined} data-testid="used-in">
        {#if used === 0}
          {t('fh_used_none')}
        {:else}
          {#if field.usedIn.tasks.length > 0}{t('fh_used_tasks', { count: field.usedIn.tasks.length })}{/if}
          {#if field.usedIn.tasks.length > 0 && field.usedIn.rules.length > 0},
          {/if}
          {#if field.usedIn.rules.length > 0}{t('fh_used_rules', { count: field.usedIn.rules.length })}{/if}
        {/if}
      </span>
    </span>
  </button>
  <div class="card-actions">
    <button
      type="button"
      class="icon-btn"
      title={field.hidden ? t('fh_show') : t('fh_hide')}
      aria-label={field.hidden ? t('fh_show') : t('fh_hide')}
      data-action={field.hidden ? 'show' : 'hide'}
      onclick={ontoggle}
    >
      {#if field.hidden}<ArrowUpFromLine size={14} />{:else}<EyeOff size={14} />{/if}
    </button>
    {#if deletable}
      <button
        type="button"
        class="icon-btn danger"
        title={t('fh_delete')}
        aria-label={t('fh_delete_field', { name: field.label })}
        data-action="delete"
        onclick={ondelete}
      >
        <Trash2 size={14} />
      </button>
    {/if}
  </div>
  {#if arrange !== undefined}
    <details class="arrange" data-testid="arrange">
      <summary
        class="icon-btn"
        title={t('fh_arrange', { name: field.label })}
        aria-label={t('fh_arrange', { name: field.label })}
      >
        <Move size={14} />
      </summary>
      <div class="arrange-body">
        <select
          class="pick"
          aria-label={t('fh_position', { name: field.label })}
          data-action="position"
          value={field.column}
          onchange={(e) => arrange.oncolumn(e.currentTarget.value as 'left' | 'right' | 'full')}
        >
          <option value="left">{t('fh_pos_left')}</option>
          <option value="right">{t('fh_pos_right')}</option>
          <option value="full">{t('fh_pos_full')}</option>
        </select>
        <select
          class="pick"
          aria-label={t('fh_move_tab')}
          data-action="tab"
          value={arrange.tab}
          onchange={(e) => {
            const v = e.currentTarget.value;
            arrange.ontab(v === HIDDEN_VALUE ? null : v);
          }}
        >
          {#each arrange.tabs as tab (tab.value ?? HIDDEN_VALUE)}
            <option value={tab.value ?? HIDDEN_VALUE}>{tab.label}</option>
          {/each}
        </select>
      </div>
    </details>
  {/if}
</div>

<style>
  .field-card {
    display: flex;
    flex-wrap: wrap;
    min-width: 0;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.25rem 0.25rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--card);
    transition: border-color 0.12s ease;
  }
  .field-card.layout {
    flex: 1 1 0;
  }
  .field-card:hover {
    border-color: color-mix(in oklab, var(--primary) 60%, transparent);
  }
  .field-card.selected {
    border-color: var(--primary);
    box-shadow: inset 2px 0 0 var(--primary);
  }
  .field-card.dragging {
    opacity: 0.45;
  }
  .card-main {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.2rem 0.25rem;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .card-main:focus-visible,
  .icon-btn:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  .card-label {
    max-width: 100%;
    overflow: hidden;
    font-size: 0.8125rem;
    color: var(--foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .star {
    color: var(--destructive);
  }
  .card-meta {
    max-width: 100%;
    overflow: hidden;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.1rem;
  }
  .icon-btn {
    display: inline-flex;
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  .grip {
    cursor: grab;
    touch-action: none;
  }
  .icon-btn.danger:hover {
    color: var(--destructive);
  }
  .arrange {
    flex-basis: 100%;
  }
  .arrange summary {
    list-style: none;
    display: inline-flex;
    margin-left: auto;
  }
  .arrange summary::-webkit-details-marker {
    display: none;
  }
  .arrange-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0;
  }
  .pick {
    min-width: 0;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    background: var(--card);
    font-size: 0.75rem;
    color: var(--foreground);
  }
</style>
