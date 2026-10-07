<script lang="ts">
  // v3 `catalog/CatalogSidebar.svelte`: the left pane. Chips add structure and tasks (click, or drag
  // for the canvas), the inventories list what the Objektart already has. It never edits: creation
  // goes up through `oncreate`, selection through `onselect` (the frame owns the document).
  import type { Component } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import FileText from '@lucide/svelte/icons/file-text';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Library from '@lucide/svelte/icons/library';
  import LogIn from '@lucide/svelte/icons/log-in';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import Square from '@lucide/svelte/icons/square';
  import Zap from '@lucide/svelte/icons/zap';
  import './catalog.css';
  import ActionList from './ActionList.svelte';
  import HiddenRow from './HiddenRow.svelte';
  import { getBuilderContext } from '../shell/context';
  import type { Translate } from '../../shell/messages';
  import type { Selection } from '../shell/registry';
  import { TASK_BADGES, type Inventory } from './inventory';
  import { CATALOG_MIME, type CatalogCreate } from './ops';

  interface Props {
    inventory: Inventory;
    t: Translate;
    selected: Selection;
    oncreate: (req: CatalogCreate) => void;
    /** True when the template locks what this chip would create (the chip shows disabled). */
    isLocked?: (req: CatalogCreate) => boolean;
    onselect: (selection: Selection) => void;
  }
  let { inventory, t, selected, oncreate, onselect, isLocked }: Props = $props();

  const ctx = getBuilderContext();
  /** "Einblenden": the ordinary `unhide` op (the template element is back in the project). */
  const unhide = (path: string): void => void ctx.apply({ kind: 'unhide', path });

  let open = $state({ actions: true, fields: true });

  interface Chip {
    readonly req: CatalogCreate;
    readonly icon: Component;
    readonly label: string;
    readonly color: string;
    readonly disabled?: boolean;
    readonly title?: string;
  }

  // v3 colours: stage grey, entry green, button grey, form blue.
  const structure = $derived<Chip[]>([
    {
      req: { kind: 'node', node: 'stage' },
      icon: Square,
      label: t('catalog_node_stage'),
      color: '#64748b',
    },
    {
      req: { kind: 'node', node: 'entry' },
      icon: LogIn,
      label: t('catalog_node_entry'),
      color: 'rgb(34 197 94)',
    },
  ]);
  // "+ Aktion" (C-004): "Von Personen" is a button or a form, "Automatisch" is what "Regel hinzufügen" was (rule plus own task).
  const tasks = $derived<Chip[]>([
    {
      req: { kind: 'task', task: 'button' },
      icon: MousePointerClick,
      label: t('catalog_task_button'),
      color: '#64748b',
    },
    { req: { kind: 'task', task: 'form' }, icon: FileText, label: t('catalog_task_form'), color: '#3b82f6' },
    { req: { kind: 'node', node: 'rule' }, icon: Zap, label: t('catalog_node_rule'), color: '#f59e0b' },
  ]);

  const chipOff = (chip: Chip): boolean => chip.disabled === true || isLocked?.(chip.req) === true;

  function dragStart(event: DragEvent, req: CatalogCreate): void {
    if (!event.dataTransfer) return;
    const mime = req.kind === 'node' ? CATALOG_MIME.node : CATALOG_MIME.task;
    event.dataTransfer.setData(mime, JSON.stringify(req));
    event.dataTransfer.effectAllowed = 'copy';
  }

  const isSelected = (kind: Selection['kind'], id: string): boolean =>
    selected.kind === kind && selected.id === id;
  const badgeText = (row: Inventory['tasks'][number]): string =>
    row.badge === TASK_BADGES.entry
      ? t('catalog_badge_entry')
      : row.badge === TASK_BADGES.many
        ? t('catalog_badge_many')
        : row.stages.join(', ');
</script>

{#snippet chips(list: Chip[])}
  <div class="chip-stack">
    {#each list as chip (chip.label)}
      {@const Icon = chip.icon}
      <button
        type="button"
        class="chip"
        style="--chip: {chip.color}"
        draggable={!chipOff(chip)}
        disabled={chipOff(chip)}
        title={isLocked?.(chip.req) === true ? t('catalog_locked') : chip.title}
        ondragstart={(e) => dragStart(e, chip.req)}
        onclick={() => oncreate(chip.req)}
      >
        <GripVertical class="chip-grip" />
        <Icon class="chip-icon" />
        <span class="chip-label">{chip.label}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet header(key: 'fields', title: string, count: number, icon?: Component)}
  {@const Lead = icon}
  <button
    type="button"
    class="section-toggle"
    aria-expanded={open[key]}
    onclick={() => (open[key] = !open[key])}
  >
    {#if open[key]}<ChevronDown class="section-chevron" />{:else}<ChevronRight class="section-chevron" />{/if}
    {#if Lead}<Lead class="section-chevron" />{/if}
    <h3 class="section-title">{title}</h3>
    <span class="section-count" data-testid="catalog-count-{key}">{count}</span>
  </button>
{/snippet}

<aside class="catalog" aria-label={t('catalog_label')} data-testid="builder-catalog">
  <section class="catalog-section">
    <h3 class="section-title">{t('catalog_structure')}</h3>
    {@render chips(structure)}
  </section>

  <section class="catalog-section">
    <h3 class="section-title">{t('catalog_add_task')}</h3>
    <p class="section-hint">{t('catalog_add_action_hint')}</p>
    {@render chips(tasks)}
  </section>

  <ActionList {inventory} {t} {selected} {onselect} bind:open={open.actions} onunhide={unhide} />

  <section class="catalog-section">
    {@render header('fields', t('catalog_fields'), inventory.fields.length, Library)}
    {#if open.fields && (inventory.fields.length > 0 || inventory.hiddenFields.length > 0)}
      <div class="item-list">
        {#each inventory.fields as row (row.key)}
          <button
            type="button"
            class="list-item"
            class:selected={isSelected('field', row.key)}
            data-path={row.path}
            onclick={() => onselect({ kind: 'field', id: row.key })}
          >
            <Library class="item-icon" />
            <span class="item-label">{row.label}</span>
          </button>
        {/each}
        {#each inventory.hiddenFields as row (row.key)}
          <HiddenRow label={row.label} path={row.path} icon={Library} {t} onunhide={unhide} />
        {/each}
      </div>
    {/if}
  </section>
</aside>

<style>
  .catalog {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--muted);
    border-right: 1px solid var(--border);
  }
  .catalog-section {
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .chip-stack {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.45rem 0.5rem 0.45rem 0.35rem;
    border-radius: 0.4rem;
    border: 1px solid var(--border);
    border-left: 3px solid var(--chip);
    background: var(--card);
    color: var(--foreground);
    cursor: grab;
    text-align: left;
    transition: all 0.15s ease;
  }
  .chip:hover:not(:disabled) {
    background: var(--accent);
    transform: translateY(-1px);
    box-shadow: 0 2px 5px color-mix(in oklab, var(--foreground) 10%, transparent);
  }
  .chip:active:not(:disabled) {
    cursor: grabbing;
    transform: translateY(0);
  }
  .chip:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .chip :global(.chip-grip) {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .chip :global(.chip-icon) {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    color: var(--chip);
  }
  .chip-label {
    font-size: 0.8125rem;
    font-weight: 500;
  }
</style>
