<script lang="ts">
  // v3 `model/FieldHub.svelte`: the Daten layout of the Objektart as a WYSIWYG: one tab per Daten sub-tab, the fields in
  // their rows and columns, plus "Ausgeblendet", the library of hidden fields. Clicking a field opens the Felddefinition
  // (WP-337, the one editor); dragging re-lays it out (`display.tab/row/column`); "Feld hinzufügen" starts a field in the
  // library. Added to v3 (WP-378): a search over every field, the key, and where each field is used.
  import Plus from '@lucide/svelte/icons/plus';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { Op } from '../../../doc';
  import { labelOf } from '../../../shell/location';
  import type { MessageKey } from '../../../shell/messages';
  import ConfirmDeleteDialog from '../../field/ConfirmDeleteDialog.svelte';
  import { deletePropertyOps, usagesOf } from '../../field/ops';
  import { createDrag, type Payload } from '../../form/drag.svelte';
  import type { Dest } from '../../form/layout';
  import { getBuilderContext } from '../../shell/context';
  import { autoLabel } from '../../rule/auto-task';
  import FieldCard from './FieldCard.svelte';
  import { HUB_DEFAULT_TAB, buildFieldHub, searchFields, type HubField } from './hub';
  import { addToTabOps, moveToTabOps, placeAtLineOps, setColumnOps, type Arrange } from './layout-ops';
  import { refusalText } from '../../shell/refusal';
  import { addFieldOp, dropOnCardOps, hideOp, showOp } from './ops';

  const ctx = getBuilderContext();
  const t = ctx.t;

  /** The library tab; a name no Daten tab can have (v3 `HIDDEN = ' hidden'`). */
  const HIDDEN = ' hidden';

  const file = $derived(ctx.doc().effective());
  const hub = $derived(buildFieldHub(file, ctx.type, ctx.locale));
  const processProperty = $derived(file.types?.[ctx.type]?.process?.property);
  const selectedKey = $derived(ctx.selection().kind === 'field' ? ctx.selection().id : undefined);

  let active = $state(HUB_DEFAULT_TAB);
  let query = $state('');
  let error = $state<string | undefined>();
  let confirmKey = $state<string | undefined>();
  let confirmOpen = $state(false);

  const searching = $derived(query.trim() !== '');
  const typeLabel = (type: string): string => t(`field_type_${type}` as MessageKey);
  const found = $derived(searching ? searchFields(hub.all, query, typeLabel) : []);
  const lines = $derived(hub.tabs.find((x) => x.name === active)?.lines ?? []);

  // Keep the active tab valid as tabs come and go (v3 `$effect`).
  $effect(() => {
    if (active !== HIDDEN && !hub.tabs.some((x) => x.name === active)) active = HUB_DEFAULT_TAB;
  });

  const tabLabel = (name: string): string => (name === HUB_DEFAULT_TAB ? t('fh_data_tab') : name);

  function run(ops: readonly Op[]): boolean {
    error = undefined;
    for (const op of ops) {
      const r = ctx.apply(op);
      if (r.refused !== undefined) {
        error = refusalText(ctx.t, ctx.doc(), [op], r.refused, ctx.locale);
        return false;
      }
    }
    return true;
  }

  function usedNames(f: HubField): string {
    const tasks = f.usedIn.tasks.map((k) => labelOf(file.tasks?.[k]?.label, ctx.locale, k));
    const rules = f.usedIn.rules.map((k) => autoLabel(file, k, ctx.locale));
    return [...tasks, ...rules].join(', ');
  }

  /** What a drop cannot say (full width, another tab): selects that write the same ops (`layout-ops.ts`). */
  function arrangeOf(f: HubField): Arrange {
    return {
      tab: active,
      tabs: [
        ...hub.tabs.map((x) => ({ value: x.name, label: tabLabel(x.name) })),
        { value: null, label: t('fh_hidden_tab') },
      ],
      oncolumn: (column) => void run(setColumnOps(file, ctx.type, f.key, column, ctx.locale)),
      ontab: (value) => void run(moveToTabOps(file, ctx.type, f.key, value, ctx.locale)),
    };
  }

  const select = (key: string): void => ctx.select({ kind: 'field', id: key });
  const toggle = (f: HubField): void =>
    void run([f.hidden ? showOp(file, ctx.type, f.key, ctx.locale) : hideOp(file, ctx.type, f.key)]);

  function add(): void {
    const next = addFieldOp(file, ctx.type, t('fh_new_field'), ctx.locale);
    if (!run([next.op])) return;
    active = HIDDEN;
    query = '';
    select(next.key);
  }

  const usage = $derived(confirmKey === undefined ? { tasks: [] } : usagesOf(file, ctx.type, confirmKey));
  const confirmTitle = $derived(
    confirmKey === undefined
      ? ''
      : t('field_delete_title', {
          name: labelOf(file.types?.[ctx.type]?.properties[confirmKey]?.label, ctx.locale, confirmKey),
        }),
  );

  function remove(): void {
    const key = confirmKey;
    confirmKey = undefined;
    confirmOpen = false;
    if (key === undefined) return;
    if (selectedKey === key) ctx.select({ kind: 'none' });
    run(deletePropertyOps(ctx.doc(), ctx.type, key));
  }

  // --- drag to re-layout: the form editor's pointer drag (`form/drag.svelte.ts`, R1); tabs are pages, Ausgeblendet is
  // the page after them ---
  const drag = createDrag({ onDrop: drop, scroller: () => undefined });
  const dragged = $derived(drag.active?.kind === 'tile' ? undefined : drag.active?.key);

  function drop(payload: Payload, dest: Dest): void {
    if (payload.kind === 'tile') return;
    const key = payload.key;
    if (dest.kind === 'page') {
      const tab = hub.tabs[dest.page]?.name;
      if (tab === undefined) run([hideOp(file, ctx.type, key)]);
      else if (run(addToTabOps(file, ctx.type, key, tab, ctx.locale))) active = tab;
    } else if (dest.kind === 'beside') {
      run(dropOnCardOps(file, ctx.type, key, dest.key, dest.column, ctx.locale));
    } else if (dest.kind === 'line') {
      run(placeAtLineOps(file, ctx.type, key, active, dest.line, ctx.locale));
    }
  }
  const pageOf = (page: number): string => JSON.stringify({ kind: 'page', page } satisfies Dest);
  const gap = (line: number): string =>
    JSON.stringify({ kind: 'line', page: 0, line, column: 'full' } satisfies Dest);
  const overGap = (line: number): boolean => drag.over?.kind === 'line' && drag.over.line === line;
</script>

{#snippet zone(at: number)}
  <div
    class="zone"
    class:shown={dragged !== undefined}
    class:active={overGap(at)}
    data-dest={gap(at)}
    data-testid={`hub-zone-${at}`}
    role="presentation"
  ></div>
{/snippet}

{#snippet card(f: HubField, layout: boolean, squeeze: boolean = false)}
  <FieldCard
    field={f}
    {t}
    {layout}
    selected={selectedKey === f.key}
    dragging={dragged === f.key}
    usedNames={usedNames(f)}
    deletable={f.key !== processProperty}
    onselect={() => select(f.key)}
    ontoggle={() => toggle(f)}
    ondelete={() => {
      confirmKey = f.key;
      confirmOpen = true;
    }}
    ongrip={(e) => drag.begin(e, { kind: 'card', key: f.key })}
    {squeeze}
    arrange={layout ? arrangeOf(f) : undefined}
  />
{/snippet}

<div class="field-hub" data-testid="field-hub">
  {#if dragged !== undefined}
    <div class="ghost" style:left="{drag.at.x + 12}px" style:top="{drag.at.y + 12}px" aria-hidden="true">
      {hub.all.find((x) => x.key === dragged)?.label ?? dragged}
    </div>
  {/if}
  <div class="toolbar">
    <Input
      type="search"
      class="search"
      placeholder={t('fh_search')}
      aria-label={t('fh_search')}
      data-testid="field-search"
      bind:value={query}
    />
    <Button variant="outline" size="sm" onclick={add} data-testid="field-add">
      <Plus size={14} />
      {t('fh_add')}
    </Button>
  </div>

  {#if !searching}
    <div class="tab-strip" role="tablist" aria-label={t('fh_tabs')}>
      {#each hub.tabs as tab, i (tab.name)}
        <button
          type="button"
          role="tab"
          class="tab"
          class:active={active === tab.name}
          class:drop-target={dragged !== undefined}
          aria-selected={active === tab.name}
          data-tab={tab.isDefault ? 'default' : tab.name}
          onclick={() => (active = tab.name)}
          data-dest={pageOf(i)}
        >
          {tabLabel(tab.name)}
        </button>
      {/each}
      <button
        type="button"
        role="tab"
        class="tab hidden-tab"
        class:active={active === HIDDEN}
        class:drop-target={dragged !== undefined}
        aria-selected={active === HIDDEN}
        data-tab="hidden"
        onclick={() => (active = HIDDEN)}
        data-dest={pageOf(hub.tabs.length)}
      >
        <EyeOff size={14} />
        {t('fh_hidden_tab')} ({hub.hidden.length})
      </button>
    </div>
  {/if}

  {#if error !== undefined}<p class="error" role="alert" data-testid="field-error">{error}</p>{/if}

  <div
    class="hub-body"
    data-dest={active === HIDDEN || searching
      ? undefined
      : pageOf(
          Math.max(
            0,
            hub.tabs.findIndex((x) => x.name === active),
          ),
        )}
    data-testid="hub-body"
  >
    {#if searching}
      <p class="hint" role="status">{t('fh_search_count', { count: found.length })}</p>
      {#if found.length === 0}
        <p class="empty">{t('fh_search_none')}</p>
      {:else}
        <div class="card-grid">
          {#each found as f (f.key)}{@render card(f, false)}{/each}
        </div>
      {/if}
    {:else if active === HIDDEN}
      <p class="hint">{t('fh_library_hint')}</p>
      {#if hub.hidden.length === 0}
        <p class="empty">{t('fh_empty')}</p>
      {:else}
        <div class="card-grid">
          {#each hub.hidden as f (f.key)}{@render card(f, false)}{/each}
        </div>
      {/if}
    {:else if lines.length === 0}
      <p class="empty">{t('fh_empty')}</p>
    {:else}
      {#each lines as line, i (i)}
        {@render zone(i)}
        <div class="layout-row">
          {#each line as f (f.key)}{@render card(f, true, line.length === 1)}{/each}
        </div>
      {/each}
      {@render zone(lines.length)}
    {/if}
  </div>
</div>

<ConfirmDeleteDialog
  bind:open={confirmOpen}
  title={confirmTitle}
  impact={usage.tasks.length > 0 ? [t('field_delete_forms', { count: usage.tasks.length })] : []}
  {t}
  onconfirm={remove}
/>

<style>
  .field-hub {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .toolbar :global(.search) {
    min-width: 0;
    max-width: 18rem;
    flex: 1 1 10rem;
  }
  .tab-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 0.375rem 0.375rem 0 0;
    background: transparent;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .tab:hover {
    background: color-mix(in oklab, var(--muted) 60%, transparent);
    color: var(--foreground);
  }
  .tab.active {
    border-color: var(--border);
    background: var(--card);
    box-shadow: inset 0 -2px 0 var(--primary);
    color: var(--foreground);
  }
  .tab.drop-target {
    border-style: dashed;
    border-color: color-mix(in oklab, var(--primary) 70%, transparent);
  }
  .tab:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  .hub-body {
    display: flex;
    min-height: 120px;
    flex-direction: column;
    gap: 0.5rem;
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .empty {
    margin: 0;
    padding: 1.5rem 0;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--destructive);
  }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
    gap: 0.5rem;
  }
  .layout-row {
    display: flex;
    gap: 0.5rem;
  }
  .zone {
    height: 0;
    border-radius: 0.25rem;
    transition: height 0.12s ease;
  }
  .zone.shown {
    height: 0.75rem;
    border: 1px dashed var(--border);
  }
  .zone.active {
    height: 1.5rem;
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 12%, transparent);
  }
  .ghost {
    position: fixed;
    z-index: 9999;
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--primary-foreground);
    white-space: nowrap;
    pointer-events: none;
    background: var(--primary);
    border-radius: 0.375rem;
  }
</style>
