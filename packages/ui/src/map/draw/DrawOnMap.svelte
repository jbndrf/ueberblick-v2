<script lang="ts">
  // Drawing a line or an area on the live map (v3 `geometry-draw-tool.svelte`, ported). A grey control stack at the
  // top right holds Abbrechen, Neues Element, one numbered tab per part, Rückgängig, Wiederherstellen, Element löschen
  // and Fertig; a tap on the map adds a vertex to the active part, a vertex can be dragged, and a tap on the first
  // vertex closes an area. The drawing itself (session, markers, overlays, validity through core.geo) is
  // `@ueberblick/ui`'s draw controller: this component is the control stack and the confirm.
  import { onDestroy, onMount, untrack } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import Plus from '@lucide/svelte/icons/plus';
  import Redo from '@lucide/svelte/icons/redo-2';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Undo from '@lucide/svelte/icons/undo-2';
  import X from '@lucide/svelte/icons/x';
  import type { Geo, Geometry } from '@ueberblick/core/geo';
  import { THEMES } from '../../tokens';
  import type { MapHandle } from '../contract';
  import { createDrawController, type DrawController } from './controller';
  import { partsOf, type DrawKind } from './model';
  import { createSession } from './session';
  import type { DrawLabels } from './labels';

  interface Props {
    handle: MapHandle;
    geo: Geo;
    kind: DrawKind;
    /** The property takes several parts (Multi*): Neues Element and the part tabs are offered (owner Q21). */
    multi: boolean;
    labels: DrawLabels;
    /** The shape now stored, redrawn from its vertices (a move task, v3 loads the current geometry). */
    initial?: Geometry;
    onconfirm: (geometry: Geometry) => void;
    oncancel: () => void;
  }
  let { handle, geo, kind, multi, labels, initial, onconfirm, oncancel }: Props = $props();

  // v3: the active part red-500, the others blue-500 (:118-119); here the theme's danger and primary
  const COLORS = { active: THEMES.normal.color.danger, idle: THEMES.normal.color.primary };
  // what is drawn does not change while the controls are open, so the session is made once
  const session = untrack(() => createSession(kind, multi, partsOf(initial, kind)));
  let controller: DrawController | undefined;
  let stop: (() => void) | undefined;
  // the session is plain state; every change of it bumps this, so the stack re-reads it
  let version = $state(0);
  let refused: string | undefined = $state();

  const view = $derived.by(() => {
    void version;
    return {
      parts: session.parts().length,
      active: session.active(),
      canUndo: session.canUndo(),
      canRedo: session.canRedo(),
      canFinish: session.canFinish(),
    };
  });

  onMount(() => {
    controller = createDrawController(handle, session, COLORS);
    stop = session.subscribe(() => {
      version++;
      refused = undefined;
    });
    handle.setDoubleClickZoom(false);
    handle.captureTaps?.(true); // a vertex inside an area is still a vertex (WP-698)
    document.body.classList.add('ub-drawing');
  });
  onDestroy(() => {
    stop?.();
    controller?.destroy();
    handle.setDoubleClickZoom(true);
    handle.captureTaps?.(false);
    document.body.classList.remove('ub-drawing');
  });

  /** Fertig: the geometry goes through core.geo; a refusal says why and the drawing stays as it is. */
  function finish(): void {
    const out = session.outcome(geo);
    if (out.state === 'ok') return onconfirm(out.geometry);
    if (out.state === 'refused') {
      const issue = out.issues[0]?.issue ?? 'self_intersection';
      refused = labels.refused(labels.issues[issue]);
    }
  }
</script>

<div class="ub-draw-controls" role="toolbar" aria-label={labels.toolbar} data-testid="draw-toolbar">
  <button
    type="button"
    class="dt-btn"
    data-testid="draw-cancel"
    title={labels.cancel}
    aria-label={labels.cancel}
    onclick={oncancel}><X size={16} /></button
  >

  {#if multi}
    <button
      type="button"
      class="dt-btn"
      data-testid="draw-new-part"
      title={labels.newPart}
      aria-label={labels.newPart}
      onclick={() => session.newPart()}><Plus size={16} /></button
    >
    {#each { length: view.parts } as _, i (i)}
      <button
        type="button"
        class="dt-btn dt-tab"
        class:active={i === view.active}
        data-testid="draw-part"
        title={labels.part(i + 1)}
        aria-label={labels.part(i + 1)}
        aria-pressed={i === view.active}
        onclick={() => session.activate(i)}>{i + 1}</button
      >
    {/each}
  {/if}

  {#if view.canUndo}
    <button
      type="button"
      class="dt-btn"
      data-testid="draw-undo"
      title={labels.undo}
      aria-label={labels.undo}
      onclick={() => session.undo()}><Undo size={16} /></button
    >
  {/if}
  {#if view.canRedo}
    <button
      type="button"
      class="dt-btn"
      data-testid="draw-redo"
      title={labels.redo}
      aria-label={labels.redo}
      onclick={() => session.redo()}><Redo size={16} /></button
    >
  {/if}

  <button
    type="button"
    class="dt-btn dt-danger"
    data-testid="draw-delete"
    title={labels.delete}
    aria-label={labels.delete}
    onclick={() => session.deleteActive()}><Trash size={16} /></button
  >

  <button
    type="button"
    class="dt-btn dt-ok"
    class:enabled={view.canFinish}
    data-testid="draw-finish"
    title={labels.finish}
    aria-label={labels.finish}
    disabled={!view.canFinish}
    onclick={finish}><Check size={16} strokeWidth={2.5} /></button
  >

  {#if refused !== undefined}
    <p class="dt-refused" role="alert" data-testid="draw-refused">{refused}</p>
  {/if}
</div>

<style>
  /* v3's control stack (`.geometry-draw-controls`, :709-720): top right, 5 px apart, above the map and below sheets */
  .ub-draw-controls {
    position: absolute;
    top: var(--ub-draw-top, 1rem);
    right: 1rem;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
    pointer-events: auto;
  }
  .dt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    background: #fff;
    color: #333;
    font-size: 0.875rem;
    font-weight: 500;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    cursor: pointer;
    transition: background-color 0.15s;
  }
  @media (prefers-reduced-motion: reduce) {
    .dt-btn {
      transition: none;
    }
  }
  .dt-btn:hover:not(:disabled) {
    background: #f4f4f4;
  }
  .dt-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .dt-tab {
    border-left: 3px solid transparent;
    font-weight: 600;
  }
  .dt-tab.active {
    border-left-color: #ef4444;
    color: #ef4444;
    font-weight: 700;
  }
  .dt-danger {
    color: #b91c1c;
  }
  .dt-ok {
    background: #e5e7eb;
    color: #6b7280;
  }
  .dt-ok.enabled {
    border-color: #059669;
    background: #10b981;
    color: #fff;
  }
  .dt-ok.enabled:hover {
    background: #059669;
  }
  .dt-refused {
    max-width: 220px;
    margin: 0;
    padding: 6px 10px;
    border-radius: 4px;
    background: #fef2f2;
    color: #b91c1c;
    font-size: 0.8125rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
  /* touch targets grow on small screens (v3 `tools-panel.css:298`, 768 px) */
  @media (max-width: 768px) {
    .dt-btn {
      width: 40px;
      height: 40px;
      font-size: 1rem;
    }
  }
  :global(body.ub-drawing .maplibregl-canvas) {
    cursor: crosshair !important;
  }
  /* v3's vertex dot (`.geometry-draw-vertex`, :782-792) */
  :global(.ub-draw-vertex) {
    cursor: move;
    touch-action: none;
  }
  :global(.ub-draw-vertex span) {
    display: block;
    width: 10px;
    height: 10px;
    border: 2px solid white;
    border-radius: 999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }
</style>
