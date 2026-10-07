<script lang="ts">
  // v3 `builder/+page.svelte`: the frame of the Objektart's builder. A toolbar (Speichern, the view
  // switch Workflow · Modell · Code, the problems badge, the name), then three panes: the catalog
  // on the left, the chosen view in the middle, the inspector on the right. The middle view and the
  // inspectors are registered by their own work packages (`registry.ts`); this file knows none.
  import { tick, untrack } from 'svelte';
  import { IsMobile } from '@ueberblick/ui';
  import type { Doc, Op } from '../../doc';
  import { problemItems, type ProblemItem } from '../../problems/model';
  import { focusPath } from '../../shell/focus';
  import { labelOf } from '../../shell/location';
  import { BUILDER_BUNDLE_MARKER } from '../../shell/marker';
  import { messages } from '../../shell/messages';
  import { setLabelOp } from '../../lenses/data-model/ops';
  import CatalogSidebar from '../catalog/CatalogSidebar.svelte';
  import { buildInventory } from '../catalog/inventory';
  import { createOp, type CatalogCreate, type NewNames } from '../catalog/ops';
  import { createLocked, opsLocked } from '../catalog/lock';
  import { refusalText } from './refusal';
  import PhoneSheets from './PhoneSheets.svelte';
  import { setBuilderContext, type BuilderContext, type BuilderLinks, type SaveOutcome } from './context';
  import BuilderToolbar from './BuilderToolbar.svelte';
  import {
    NO_SELECTION,
    parseView,
    type BuilderRegistry,
    type BuilderView,
    type PaneWidth,
    type Selection,
    PANE_WIDTHS,
  } from './registry';
  import { selectionForPath } from './selection';

  interface Props {
    doc: Doc;
    /** The feature type (Objektart) key. */
    type: string;
    locale?: string;
    registry: BuilderRegistry;
    /** The view from the address (`?view=`); the frame keeps its own when the host does not pass one. */
    view?: BuilderView | undefined;
    onviewchange?: (view: BuilderView) => void;
    /** Writes the overlay text to the draft; the host reaches the server. */
    onsave?: (overlaySrc: string) => Promise<SaveOutcome>;
    /** The document has (not) unsaved changes: the host guards leaving the page. */
    ondirty?: (dirty: boolean) => void;
    /** An edit was applied. */
    onchange?: (doc: Doc) => void;
    /**
     * "Veröffentlichen" (WP-360): the host opens the deploy overview. The frame saves unsaved changes first, because the
     * overview plans the saved draft. Without it the toolbar has no such button.
     */
    ondeploy?: () => void;
    /** A key path to select and focus (the "Gehe zu" of the deploy overview, `?select=`); the frame tells `onfocused` when done. */
    focusTarget?: string | null;
    onfocused?: () => void;
    /** The address of another Objektart's builder, for the sub-process links on the canvas (S4-5). */
    typeHref?: ((type: string) => string) | undefined;
    /** The host's pages the panes link to (the type settings' "Standardfilter & Marker-Symbole"). */
    links?: BuilderLinks;
  }
  let {
    doc,
    type,
    locale = 'de',
    registry,
    view: viewProp,
    onviewchange,
    onsave,
    ondirty,
    onchange,
    ondeploy,
    focusTarget = null,
    onfocused,
    typeHref,
    links = {},
  }: Props = $props();

  let current: Doc = $state(untrack(() => doc));
  /** The revision the store last accepted: `saveIf` refuses a doc that is stale against it. */
  let storeRevision = untrack(() => doc.revision);
  let selection: Selection = $state(NO_SELECTION);
  let localView: BuilderView = $state(untrack(() => parseView(viewProp)));
  let saving = $state(false);
  let outcome: SaveOutcome | undefined = $state();
  let refusal = $state('');
  let rootEl: HTMLElement | undefined = $state();
  // Below 768 px the catalog and the inspector are sheets over the full-width canvas (WP-345).
  // The kit's `IsMobile` is the one breakpoint (768 px); the `@media` CSS below uses the same width.
  const phone = new IsMobile();
  let catalogOpen = $state(false);
  let inspectorOpen = $state(false);
  /** The width the open pane asked for (the stage pane with its field palette open); the registered one otherwise. */
  let paneOverride: PaneWidth | undefined = $state();

  const t = $derived(messages(locale));
  const view = $derived(viewProp ?? localView);
  const dirty = $derived(current.dirty);
  const typeLabel = $derived(labelOf(current.effective().types?.[type]?.label, locale, type));
  const inventory = $derived(buildInventory(current, type, locale));
  // This Objektart's problems, and the project-level ones; those of other Objektarten show in their builder.
  const items = $derived(
    problemItems(current, locale).filter((p) => p.location.type === undefined || p.location.type === type),
  );
  const viewLabels: Record<BuilderView, () => string> = {
    workflow: () => t('frame_view_workflow'),
    model: () => t('frame_view_model'),
    code: () => t('frame_view_code'),
  };

  $effect(() => ondirty?.(dirty));

  function apply(op: Op) {
    const r = current.apply(op);
    refusal = r.refused === undefined ? '' : refusalText(t, current, [op], r.refused, locale);
    if (r.refused === undefined && r.doc !== current) {
      current = r.doc;
      outcome = undefined;
      onchange?.(r.doc);
    }
    return r;
  }

  function applyBatch(ops: readonly Op[]) {
    const r = current.applyBatch(ops);
    refusal = 'refused' in r ? refusalText(t, current, ops, r.refused, locale) : '';
    if (!('refused' in r) && r.doc !== current) {
      current = r.doc;
      outcome = undefined;
      onchange?.(r.doc);
    }
    return r;
  }

  /** Selecting opens the inspector sheet on a phone; clearing closes it. Closing a sheet keeps the selection. */
  function choose(s: Selection): void {
    selection = s;
    catalogOpen = false;
    inspectorOpen = s.kind !== NO_SELECTION.kind;
  }

  const ctx: BuilderContext = setBuilderContext({
    type: untrack(() => type),
    locale: untrack(() => locale),
    t: untrack(() => messages(locale)),
    doc: () => current,
    view: () => view,
    selection: () => selection,
    select: choose,
    apply,
    typeHref: untrack(() => typeHref),
    links: untrack(() => links),
    applyBatch,
    setPaneWidth: (width) => (paneOverride = width),
  });

  function setView(next: BuilderView): void {
    localView = next;
    onviewchange?.(next);
  }

  const newNames = (): NewNames => ({
    task: t('catalog_new_task'),
    entry: t('catalog_new_entry'),
    stage: t('catalog_new_stage'),
    rule: t('catalog_new_rule'),
    process: t('catalog_new_process'),
    endStage: t('catalog_new_end_stage'),
  });

  function create(req: CatalogCreate): void {
    const r = createOp(current.effective(), type, req, locale, newNames());
    if (!r.ok) {
      refusal = t('catalog_no_process');
      return;
    }
    // One create is all or nothing and one undo step (a rule is its task and the rule; a first stage is the process).
    const ops = [r.op, ...(r.after ?? [])];
    // A create the template locks says so in the admin's language; the engine's text stays out of the catalog.
    if (opsLocked(current, ops)) {
      refusal = t('catalog_locked');
      return;
    }
    if ('refused' in applyBatch(ops)) {
      refusal = t('catalog_refused');
      return;
    }
    choose(r.select);
  }

  async function focusProblem(item: ProblemItem): Promise<void> {
    if (!registry.focus(item, ctx)) {
      choose(selectionForPath(type, item.path));
      await tick();
      if (rootEl !== undefined) focusPath(rootEl, item.path, null);
    }
  }

  /** Writes the draft when it has unsaved changes, then opens the host's deploy overview (it plans the saved draft). */
  async function deploy(): Promise<void> {
    if (pending !== null) await pending;
    if (dirty || outcome !== undefined) {
      await save();
      if (outcome !== undefined) return; // a conflict or a failed write is shown; nothing to deploy yet
    }
    ondeploy?.();
  }

  // "Gehe zu" of a blocker: select the entity its key path points into and focus it, then tell the host.
  $effect(() => {
    const path = focusTarget;
    if (path === null || path === '') return;
    untrack(() => {
      choose(selectionForPath(type, path));
      void tick().then(() => {
        if (rootEl !== undefined) focusPath(rootEl, path, null);
        onfocused?.();
      });
    });
  });

  /** The save in flight, so "Veröffentlichen" can wait for it instead of planning the old draft. */
  let pending: Promise<void> | null = null;

  function save(): Promise<void> {
    if (pending !== null) return pending;
    if (onsave === undefined) return Promise.resolve();
    pending = write().finally(() => (pending = null));
    return pending;
  }

  async function write(): Promise<void> {
    if (onsave === undefined) return;
    saving = true;
    outcome = undefined;
    const r = current.saveIf(storeRevision);
    if (!r.ok) {
      outcome = 'conflict';
    } else {
      outcome = await onsave(r.overlaySrc);
      if (outcome === 'saved') {
        current = r.doc;
        storeRevision = r.doc.revision;
        outcome = undefined;
      }
    }
    saving = false;
  }

  function commitName(event: Event & { currentTarget: HTMLInputElement }): void {
    const text = event.currentTarget.value.trim();
    if (text === '' || apply(setLabelOp(current.effective(), `types.${type}`, locale, text)).refused) {
      event.currentTarget.value = typeLabel;
    }
  }

  const MiddleView = $derived(registry.view(view));
  const inspector = $derived(registry.inspector(selection.kind));
</script>

{#snippet inspectorBody()}
  {#if inspector}
    {@const Inspector = inspector.component}
    <Inspector />
  {:else}
    <p class="placeholder">{t('frame_placeholder', { name: t('frame_inspector') })}</p>
  {/if}
{/snippet}

{#snippet catalogPane()}
  <CatalogSidebar
    {inventory}
    {t}
    selected={selection}
    oncreate={create}
    onselect={choose}
    isLocked={(req) => createLocked(current, type, req, locale, newNames())}
  />
{/snippet}

{#snippet inspectorAside()}
  <aside
    class="inspector"
    style:--pane-w="{PANE_WIDTHS[paneOverride ?? inspector?.width ?? 'default']}px"
    aria-label={t('frame_inspector')}
    data-testid="builder-inspector"
  >
    {@render inspectorBody()}
  </aside>
{/snippet}

<div class="builder" bind:this={rootEl} data-testid="builder-frame" data-builder={BUILDER_BUNDLE_MARKER}>
  <BuilderToolbar
    {t}
    {view}
    {viewLabels}
    phone={phone.current}
    {saving}
    canSave={onsave !== undefined}
    ondeploy={ondeploy === undefined ? undefined : () => void deploy()}
    {dirty}
    {outcome}
    {refusal}
    {items}
    {typeLabel}
    bind:catalogOpen
    bind:inspectorOpen
    onsave={save}
    onsetview={setView}
    onsettings={() => choose({ kind: 'type', id: type })}
    onfocusproblem={focusProblem}
    oncommitname={commitName}
  />

  <div class="content">
    {#if view !== 'code' && !phone.current}
      {@render catalogPane()}
    {/if}

    <main class="center" data-testid="builder-center" data-view={view}>
      {#if MiddleView}
        <MiddleView />
      {:else}
        <p class="placeholder">{t('frame_placeholder', { name: viewLabels[view]() })}</p>
      {/if}
    </main>

    {#if view !== 'code' && !phone.current}
      {@render inspectorAside()}
    {/if}
  </div>
</div>

{#if phone.current && view !== 'code'}
  <PhoneSheets
    {t}
    {saving}
    canSave={onsave !== undefined}
    onsave={save}
    bind:catalogOpen
    bind:inspectorOpen
    catalog={catalogPane}
    inspector={inspectorAside}
  />
{/if}

<style>
  .builder {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--background);
    color: var(--foreground);
  }
  .content {
    display: flex;
    flex: 1;
    min-height: 0;
    /* clip, not hidden: a focused field must not scroll this box (and with it the toolbar) out of place. */
    overflow: clip;
  }
  .center {
    flex: 1;
    position: relative;
    display: flex;
    min-width: 0;
    overflow: auto;
    background: var(--card);
  }
  .inspector {
    width: var(--pane-w, 360px);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--card);
    border-left: 1px solid var(--border);
  }
  .placeholder {
    margin: 1rem;
    font-size: 0.8125rem;
    font-style: italic;
    color: var(--muted-foreground);
  }
</style>
