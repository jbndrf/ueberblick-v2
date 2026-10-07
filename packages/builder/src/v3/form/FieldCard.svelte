<script lang="ts">
  // v3 `form-editor/FieldCard.svelte`: one field of the form as the participant sees it: grip (drag), label (click
  // to rename), required star, the disabled `FieldInput`, help text, badges (validation, condition, type icon);
  // click selects. v3's right-click menu is also the "⋯" button, so a phone has it. New here: a bar (up, down,
  // width, "Beginnt eine neue Seite", remove; always on a touch screen, a finger cannot drag with certainty) and
  // the provenance mark (WP-445).
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Shield from '@lucide/svelte/icons/shield';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { FieldInput, type ToolSlot } from '@ueberblick/ui';
  import type { Translate } from '../../shell/messages';
  import ProvenanceMark from '../shared/ProvenanceMark.svelte';
  import { fieldProvenance } from '../shared/provenance-field.svelte';
  import { getBuilderContext } from '../shell/context';
  import CardBar from './CardBar.svelte';
  import type { Drag } from './drag.svelte';
  import type { Column } from './layout';
  import type { FieldView } from './model';
  import { TYPE_ICONS } from './palette';
  import PreviewTool from './PreviewTool.svelte';

  interface Props {
    t: Translate;
    locale: string;
    view: FieldView;
    column: Column;
    selected: boolean;
    dragging: boolean;
    half: boolean;
    /** The property carries the process (stage): it cannot be deleted from here. */
    protectedKey: boolean;
    drag: Drag;
    onselect: () => void;
    onrename: (text: string) => void;
    onremove: () => void;
    ondelete: () => void;
  }
  let {
    t,
    locale,
    view,
    column,
    selected,
    dragging,
    half,
    protectedKey,
    drag,
    onselect,
    onrename,
    onremove,
    ondelete,
  }: Props = $props();

  let editing = $state(false);
  let draft = $state('');
  let input: HTMLInputElement | undefined = $state();
  let menu = $state(false);

  // Where the field comes from (WP-445): the mark here, the menu entries in `CardMenu` (through the context).
  const prov = fieldProvenance(getBuilderContext(), () => view.key);

  $effect(() => {
    if (editing && input !== undefined) {
      input.focus();
      input.select();
    }
  });

  function startEditing(e: Event): void {
    e.stopPropagation();
    draft = view.label;
    editing = true;
  }

  function finish(): void {
    if (!editing) return;
    editing = false;
    const text = draft.trim();
    if (text !== '' && text !== view.label) onrename(text);
  }

  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing = false;
    }
  }
  const Icon = $derived(view.type === undefined ? Pencil : TYPE_ICONS[view.type]);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="card"
  class:selected
  class:open={menu}
  class:dragging
  class:half
  data-testid="field-card"
  data-key={view.key}
  data-column={column}
  role="group"
  aria-label={view.label}
  tabindex="0"
  onclick={onselect}
  onkeydown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onselect()}
  oncontextmenu={(e) => {
    e.preventDefault();
    menu = true;
  }}
>
  <button
    type="button"
    class="grip"
    data-testid="field-grip"
    aria-label={t('form_card_drag')}
    title={t('form_card_drag')}
    onpointerdown={(e) => {
      e.stopPropagation();
      drag.begin(e, { kind: 'card', key: view.key });
    }}
    onclick={(e) => e.stopPropagation()}
  >
    <GripVertical size={16} />
  </button>

  {#if editing}
    <input
      bind:this={input}
      class="label-input"
      data-testid="card-label-input"
      aria-label={t('form_card_rename')}
      bind:value={draft}
      onblur={finish}
      onkeydown={keydown}
      onclick={(e) => e.stopPropagation()}
    />
  {:else}
    <button
      type="button"
      class="label"
      data-testid="card-label"
      title={t('form_card_rename')}
      onclick={startEditing}
    >
      <span class="label-text">
        {view.label}{#if view.required}<span class="required" aria-hidden="true">*</span>{/if}
      </span>
      <span class="edit-hint"><Pencil size={12} /></span>
    </button>
  {/if}

  <div class="preview" inert>
    {#if view.field !== undefined}
      <FieldInput
        field={{ ...view.field, label: '' }}
        value={undefined}
        {locale}
        required={false}
        readonly={true}
        onchange={() => {}}
        tool={previewTool}
      />
    {:else}
      <p class="unknown">{t('form_card_unknown')}</p>
    {/if}
  </div>

  <div class="badges">
    {#if prov.info !== undefined}<ProvenanceMark {t} info={prov.info} />{/if}
    {#if view.computed}
      <span class="badge computed" title={t('form_card_computed')}><Sparkles size={10} /></span>
    {/if}
    {#if view.validated}
      <span class="badge validation" title={t('form_card_validated')}><Shield size={10} /></span>
    {/if}
    {#if view.conditional}
      <span class="badge conditional" title={t('form_card_conditional')}><GitBranch size={10} /></span>
    {/if}
    <span class="badge type"><Icon size={12} /></span>
  </div>

  {#if prov.error !== undefined}<p class="unknown" role="alert">{prov.error}</p>{/if}

  <CardBar {t} {view} {protectedKey} bind:menu {onremove} {ondelete} />
</div>

{#snippet previewTool(slot: ToolSlot)}
  <PreviewTool {t} type={slot.field.type} />
{/snippet}

<style>
  .card {
    position: relative;
    padding: 0.875rem 0.875rem 0.5rem 2rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .card:hover {
    border-color: color-mix(in oklab, var(--primary) 50%, transparent);
    box-shadow: 0 2px 8px color-mix(in oklab, var(--foreground) 6%, transparent);
  }
  .card.selected {
    border-color: var(--primary);
    box-shadow:
      0 0 0 2px color-mix(in oklab, var(--primary) 15%, transparent),
      0 2px 8px color-mix(in oklab, var(--foreground) 8%, transparent);
  }
  .card.dragging {
    opacity: 0.5;
    transform: scale(0.98);
  }
  .card.half {
    padding: 0.625rem 0.625rem 0.375rem 1.75rem;
  }
  .grip {
    position: absolute;
    left: 0.125rem;
    top: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 2.75rem;
    padding: 0;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    opacity: 0.6;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .card:hover .grip,
  .card.selected .grip,
  .grip:hover {
    opacity: 1;
  }
  .grip:hover {
    background: var(--muted);
    color: var(--foreground);
  }
  .label {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin: 0 0 0.375rem -0.375rem;
    padding: 0.125rem 0.375rem;
    max-width: calc(100% - 4.5rem);
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
    text-align: left;
    background: transparent;
    border: 1px dashed transparent;
    border-radius: 0.25rem;
    cursor: text;
  }
  .label:hover {
    background: color-mix(in oklab, var(--muted) 60%, transparent);
    border-color: var(--border);
  }
  .label-text {
    min-width: 0;
    overflow-wrap: break-word;
    hyphens: auto;
  }
  .edit-hint {
    display: flex;
    opacity: 0;
    color: var(--muted-foreground);
  }
  .label:hover .edit-hint,
  .label:focus-visible .edit-hint {
    opacity: 1;
  }
  .label-input {
    display: block;
    width: calc(100% - 4rem);
    margin: 0 0 0.375rem -0.375rem;
    padding: 0.125rem 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--primary);
    border-radius: 0.25rem;
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary) 20%, transparent);
  }
  .required {
    margin-left: 0.125rem;
    color: var(--destructive);
  }
  .preview {
    pointer-events: none;
  }
  .unknown {
    margin: 0;
    font-size: 0.75rem;
    color: var(--destructive);
  }
  .badges {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  /* A half-width card is narrow: the badges leave the corner and sit above the label, the label gets the width. */
  .card.half .badges {
    position: static;
    justify-content: flex-end;
    margin: -0.25rem 0 0.25rem;
  }
  .card.half .label {
    max-width: 100%;
  }
  .card.half .label-input {
    width: 100%;
  }
  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 0.25rem;
  }
  .badge.validation {
    color: hsl(38 92% 50%);
    background: hsl(38 92% 50% / 0.15);
  }
  .badge.conditional {
    color: hsl(221 83% 53%);
    background: hsl(221 83% 53% / 0.15);
  }
  .badge.computed {
    color: hsl(280 60% 60%);
    background: hsl(280 60% 60% / 0.15);
  }
  .badge.type {
    width: 20px;
    height: 20px;
    color: var(--muted-foreground);
    background: var(--muted);
    opacity: 0.7;
  }
  .card.selected .badge.type {
    color: var(--primary);
    background: color-mix(in oklab, var(--primary) 10%, transparent);
    opacity: 1;
  }
  .card:hover :global(.bar),
  .card.selected :global(.bar),
  .card:focus-within :global(.bar),
  .card.open :global(.bar) {
    display: flex;
  }
</style>
