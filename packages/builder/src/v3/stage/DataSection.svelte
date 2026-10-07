<script lang="ts">
  // v3 `DataTabsSection.svelte`: the participant's Daten view under the buttons, with its tab strip ("Tab hinzufügen"),
  // the rename and delete of the active tab, and the form grid of the active tab. A property is put in a tab from the
  // library panel ("Felder zum aktiven Tab hinzufügen"), by dragging it onto a tab, or sent back ("Aus Tab entfernen").
  // The order of the fields is changed by dragging a card by its grip, as in the form editor. Every edit is the Felder
  // hub's op (`model/fields/layout-ops.ts`, R1): tabs are `display.tab` / `tab_order`. With a role chosen, hidden properties are greyed with the reason
  // and read-only ones marked, so the admin sees the role's view while building.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { Op } from '../../doc';
  import type { Translate } from '../../shell/messages';
  import { HUB_DEFAULT_TAB, buildFieldHub } from '../model/fields/hub';
  import {
    addToTabOps,
    deleteTabOps,
    newTabName,
    placeAtLineOps,
    renameTabOps,
  } from '../model/fields/layout-ops';
  import { dropOnCardOps } from '../model/fields/ops';
  import { getBuilderContext } from '../shell/context';
  import { createDrag, type Payload } from '../form/drag.svelte';
  import type { Dest } from '../form/layout';
  import DataLibrary from './DataLibrary.svelte';
  import DataTabBar from './DataTabBar.svelte';
  import DataRow from './DataRow.svelte';
  import type { PreviewProperty } from './preview';

  interface Props {
    properties: readonly PreviewProperty[];
    t: Translate;
    /** A role is chosen, so visibility and edit rights mean something. */
    byRole: boolean;
    onselect: (key: string) => void;
    /** Applies ops one by one; false when one is refused (the pane shows why). */
    run: (ops: readonly Op[]) => boolean;
    onnotice: (message: string) => void;
  }
  let { properties, t, byRole, onselect, run, onnotice }: Props = $props();

  const ctx = getBuilderContext();
  const file = $derived(ctx.doc().effective());
  const hub = $derived(buildFieldHub(file, ctx.type, ctx.locale));
  const byKey = $derived(new Map(properties.map((p) => [p.key, p])));

  let active = $state(HUB_DEFAULT_TAB);
  /** Tabs made with "+" that hold no property yet: local, until a property lands (v3 `transientTabs`). */
  let transient = $state<string[]>([]);
  let libraryOpen = $state(false);
  let confirming = $state(false);

  const names = $derived([
    ...hub.tabs.map((x) => x.name),
    ...transient.filter((n) => !hub.tabs.some((x) => x.name === n)),
  ]);
  const lines = $derived(hub.tabs.find((x) => x.name === active)?.lines ?? []);
  const activeKeys = $derived(new Set(lines.flat().map((f) => f.key)));
  const isCustom = $derived(active !== HUB_DEFAULT_TAB);
  const label = (name: string): string => (name === HUB_DEFAULT_TAB ? t('stage_data') : name);

  // v3 `InspectorHost.svelte:79-93`: the pane grows by the palette (520 -> 720 px) so the preview keeps its size.
  $effect(() => {
    ctx.setPaneWidth(libraryOpen ? 'wideStage' : undefined);
    return () => ctx.setPaneWidth(undefined);
  });
  // Keep the active tab pointing at a tab that exists (v3 `$effect`).
  $effect(() => {
    if (!names.includes(active)) active = HUB_DEFAULT_TAB;
  });
  // A tab that gained a property is no longer transient.
  $effect(() => {
    const real = new Set(hub.tabs.map((x) => x.name));
    if (transient.some((n) => real.has(n))) transient = transient.filter((n) => !real.has(n));
  });

  function addTab(): void {
    const name = newTabName(names.map(label), t('stage_tab_new'));
    transient = [...transient, name];
    active = name;
    confirming = false;
  }

  function rename(to: string): void {
    const name = to.trim();
    if (name !== active && names.map(label).includes(name)) {
      onnotice(t('stage_tab_taken', { name }));
      return;
    }
    const ok = run(renameTabOps(file, ctx.type, active, name, ctx.locale));
    if (!ok) return;
    transient = transient.map((n) => (n === active ? name : n));
    active = name;
  }

  function askDelete(): void {
    if (deleteTabOps(file, ctx.type, active, ctx.locale).length === 0) remove();
    else confirming = true;
  }

  function remove(): void {
    const ok = run(deleteTabOps(file, ctx.type, active, ctx.locale));
    confirming = false;
    if (!ok) return;
    transient = transient.filter((n) => n !== active);
    active = HUB_DEFAULT_TAB;
  }

  const put = (key: string, tab: string): void => void run(addToTabOps(file, ctx.type, key, tab, ctx.locale));

  // --- drag: the form editor's pointer drag (`form/drag.svelte.ts`, R1); a drop does what v3's `onTabDrop`,
  // `handleFieldRefDrop` did, as the same ops ---
  const drag = createDrag({ onDrop: drop, scroller: () => undefined });
  const dragged = $derived(drag.active?.kind === 'tile' ? undefined : drag.active?.key);
  const ghost = $derived(dragged === undefined ? '' : (byKey.get(dragged)?.label ?? dragged));

  function drop(payload: Payload, dest: Dest): void {
    if (payload.kind === 'tile') return;
    const key = payload.key;
    if (dest.kind === 'page') {
      const tab = names[dest.page];
      if (tab !== undefined) put(key, tab);
    } else if (dest.kind === 'beside') {
      run(dropOnCardOps(file, ctx.type, key, dest.key, dest.column, ctx.locale));
    } else if (dest.kind === 'line') {
      run(placeAtLineOps(file, ctx.type, key, active, dest.line, ctx.locale));
    }
  }
  const gap = (line: number): string =>
    JSON.stringify({ kind: 'line', page: names.indexOf(active), line, column: 'full' } satisfies Dest);
  const overGap = (line: number): boolean => drag.over?.kind === 'line' && drag.over.line === line;
</script>

{#snippet zone(at: number)}
  <div
    class="zone"
    class:shown={dragged !== undefined}
    class:active={overGap(at)}
    data-dest={gap(at)}
    data-testid={`stage-zone-${at}`}
    role="presentation"
  ></div>
{/snippet}

<div class="data" data-testid="stage-data">
  {#if dragged !== undefined}
    <div class="ghost" style:left="{drag.at.x + 12}px" style:top="{drag.at.y + 12}px" aria-hidden="true">
      {ghost}
    </div>
  {/if}
  <div class="panel-row">
    <button
      type="button"
      class="palette-toggle"
      class:open={libraryOpen}
      aria-expanded={libraryOpen}
      title={libraryOpen ? t('stage_tab_collapse') : t('stage_tab_add_fields')}
      aria-label={t('stage_tab_add_fields')}
      data-testid="stage-library-toggle"
      onclick={() => (libraryOpen = !libraryOpen)}
    >
      {#if libraryOpen}<ChevronRight size={16} />{:else}<ChevronLeft size={16} />{/if}
      <span>{t('stage_tab_add_fields')}</span>
    </button>
  </div>
  {#if libraryOpen}
    <DataLibrary
      {t}
      fields={hub.all}
      used={activeKeys}
      onpick={(key) => put(key, active)}
      ongrab={(e, key) => drag.begin(e, { kind: 'property', key })}
    />
  {/if}

  <DataTabBar
    {t}
    {names}
    {active}
    {label}
    {isCustom}
    {confirming}
    dropping={dragged !== undefined}
    onactivate={(name) => {
      active = name;
      confirming = false;
    }}
    onadd={addTab}
    onrename={rename}
    onaskdelete={askDelete}
    onremove={remove}
    oncancel={() => (confirming = false)}
  />

  {#if hub.all.length === 0}
    <p class="empty-hint">{t('stage_no_fields')}</p>
  {:else}
    <div
      class="tabpanel"
      role="tabpanel"
      tabindex="0"
      data-dest={JSON.stringify({ kind: 'page', page: names.indexOf(active) })}
    >
      {#if lines.length === 0}
        <p class="empty-hint">{t('fh_empty')}</p>
      {/if}
      {#each lines as line, i (i)}
        {@render zone(i)}
        <ul class="line">
          {#each line as f (f.key)}
            {@const p = byKey.get(f.key)}
            <DataRow
              {t}
              key={f.key}
              label={f.label}
              dimmed={byRole && p?.visible === false}
              readonly={byRole && p?.visible !== false && p?.editable === false}
              visible={p?.visible ?? true}
              editable={p?.editable ?? true}
              squeeze={line.length === 1}
              removable={isCustom}
              {byRole}
              dragging={dragged === f.key}
              {onselect}
              onremove={() => put(f.key, HUB_DEFAULT_TAB)}
              ongrip={(e) => drag.begin(e, { kind: 'card', key: f.key })}
            />
          {/each}
        </ul>
      {/each}
      {#if lines.length > 0}{@render zone(lines.length)}{/if}
    </div>
  {/if}
</div>

<style>
  .data {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .palette-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2rem;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    cursor: pointer;
  }
  .palette-toggle:hover,
  .palette-toggle.open {
    background: var(--accent);
    color: var(--foreground);
  }
  .tabpanel {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-height: 3rem;
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
  .line {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 0.375rem;
  }
  .empty-hint {
    margin: 0;
    padding: 1rem 0.5rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
</style>
