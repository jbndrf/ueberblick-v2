<script lang="ts">
  // Pin placement (v3 WorkflowSelector, coordinate selection mode, :171-345): a red pin that starts at the middle of
  // the map and that the person drags anywhere or moves with a tap on the map, the red confirm pill (the task's
  // label) with a cross to cancel, and a dashed line from the pill to the pin. The pin is a map marker and the line
  // a map overlay (MapHandle marker API), so nothing here re-draws a feature while the pin is dragged.
  import { LAYER } from '../../layers';
  import { onDestroy, onMount } from 'svelte';
  import { THEMES, type MapHandle } from '@ueberblick/ui';
  import type { Bbox, Geometry, Position } from '@ueberblick/core/geo';
  import type { Candidate } from '../../create/chain';
  import ChainLink from './ChainLink.svelte';
  import { centerOfExtent } from '../../map-view';
  import { message, type Locale } from '../../messages';
  import { pointAt } from './creatable';

  interface Props {
    handle: MapHandle;
    label: string;
    locale: Locale;
    /** Where the pin starts, instead of the middle of the map: the point now stored (a move task, v3 `LocationEditTool`). */
    initial?: Geometry;
    /** The parent picked with the chain (WP-677); undefined: the object is placed on its own. */
    onconfirm: (position: Geometry, parent?: Candidate) => void;
    oncancel: () => void;
    /** The parents the person may chain to, in view (v3: offered when the type has an optional parent). Absent: no chip. */
    candidates?: (extent: Bbox, around: Position) => readonly Candidate[];
  }
  let { handle, label, locale, initial, onconfirm, oncancel, candidates }: Props = $props();

  const PIN = 'placement-pin';
  const LINE = 'placement-connector';
  // v3's connector: red, 2 px, 70 % opaque, dashed (WorkflowSelector.svelte:262-267); the colour is the theme's danger
  const DANGER = THEMES.normal.color.danger;
  const LINE_STYLE = { color: DANGER, width: 2, opacity: 0.7, dashed: true } as const;
  // v3's chain line: indigo, 2 px, 80 % opaque, dotted (WorkflowSelector.svelte:293-298), from the pin to the parent
  const LINK = 'placement-link';
  const LINK_STYLE = { color: '#6366f1', width: 2, opacity: 0.8, dashed: true } as const;

  let at: Position | undefined = $state();
  let armed = $state(false);
  let parent: Candidate | undefined = $state();
  let box: HTMLElement | undefined = $state();
  let pill: HTMLElement | undefined = $state();
  let frame = 0;
  const stops: (() => void)[] = [];

  // v3's pin: a 20 px red dot with a white border and a dashed pulsing ring (`.temp-marker-inner`, :479-521)
  function pinElement(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ub-placement-pin';
    el.style.setProperty('--ub-pin', DANGER);
    el.dataset.testid = PIN;
    el.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('div');
    dot.className = 'ub-placement-pin-dot';
    el.appendChild(dot);
    return el;
  }

  /** From the middle of the confirm pill to the pin; the pill sits on screen, so its centre is made relative to the map's box. */
  function drawLine(): void {
    frame = 0;
    const from = pill?.getBoundingClientRect();
    const origin = box?.getBoundingClientRect();
    if (from === undefined || origin === undefined || at === undefined) return;
    const start = handle.unproject({
      x: from.left + from.width / 2 - origin.left,
      y: from.top + from.height / 2 - origin.top,
    });
    if (start === undefined) return;
    handle.showOverlay(LINE, { type: 'LineString', coordinates: [start, at] }, LINE_STYLE);
  }
  // one redraw per frame, as v3's requestAnimationFrame (:253-286)
  function scheduleLine(): void {
    if (frame === 0) frame = requestAnimationFrame(drawLine);
  }
  /** The chain: closing it is standalone creation, opening it arms the rings (v3 `handleChainToggle`). */
  function toggleChain(): void {
    armed = !armed;
    if (!armed) parent = undefined;
  }
  /** A tap on a candidate selects it AND puts the pin there (v3 `handleLinkCandidateTap`). */
  function pick(c: Candidate): void {
    parent = c;
    handle.moveMarker(PIN, c.at);
    place(c.at);
  }
  // the dotted line follows the pin and the parent; no parent or an open chain: none
  $effect(() => {
    if (armed && parent !== undefined && at !== undefined)
      handle.showOverlay(LINK, { type: 'LineString', coordinates: [at, parent.at] }, LINK_STYLE);
    else handle.clearOverlay(LINK);
  });
  function place(next: Position): void {
    at = next;
    scheduleLine();
  }

  onMount(() => {
    handle.captureTaps?.(true); // the pin owns the tap, also over an area or a tree (WP-698; v3 `isEditingLocation`)
    const start = initial?.type === 'Point' ? (initial.coordinates as Position) : centerOfExtent(handle);
    if (start !== undefined) {
      handle.addMarker(PIN, start, { element: pinElement(), draggable: true });
      place(start);
    }
    stops.push(
      handle.onMarkerDrag((id, p) => id === PIN && place(p)),
      // a tap on the map puts the pin there (v3 :230-241)
      handle.onMapTap((p) => {
        handle.moveMarker(PIN, p);
        place(p);
      }),
      handle.onMove(scheduleLine),
    );
  });
  onDestroy(() => {
    stops.forEach((s) => s());
    handle.captureTaps?.(false);
    if (frame !== 0) cancelAnimationFrame(frame);
    handle.removeMarker(PIN);
    handle.clearOverlay(LINE);
    handle.clearOverlay(LINK);
  });
</script>

<!-- the host places this inside the map's own box: it gives the origin of the map's px -->
<div bind:this={box} class="pointer-events-none absolute inset-0" aria-hidden="true"></div>

{#if candidates !== undefined}
  <ChainLink
    {handle}
    {locale}
    toggle={true}
    {armed}
    ontoggle={toggleChain}
    {candidates}
    selected={parent?.id}
    onpick={pick}
  />
{/if}

<div
  bind:this={pill}
  class={[
    'fixed bottom-20 left-1/2 flex -translate-x-1/2 items-center justify-between gap-3 rounded-full bg-red-700 px-5 py-3 text-white shadow-lg lg:bottom-8',
    LAYER.pill,
  ]}
>
  <button
    type="button"
    data-testid="placement-confirm"
    class="flex-1 text-center font-semibold"
    title={message(locale, 'create_pin')}
    disabled={at === undefined}
    onclick={() => at !== undefined && onconfirm(pointAt(at[0], at[1]), armed ? parent : undefined)}
    >{label}</button
  >
  <button
    type="button"
    data-testid="placement-cancel"
    class="text-2xl leading-none font-bold"
    aria-label={message(locale, 'create_cancel')}
    onclick={oncancel}>&times;</button
  >
</div>

<style>
  :global(.ub-placement-pin) {
    cursor: move;
    touch-action: none;
  }
  :global(.ub-placement-pin-dot) {
    position: relative;
    width: 20px;
    height: 20px;
    border: 2px solid white;
    border-radius: 50%;
    background-color: color-mix(in srgb, var(--ub-pin) 90%, transparent);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  :global(.ub-placement-pin-dot::after) {
    content: '';
    position: absolute;
    inset: -6px;
    border: 2px dashed color-mix(in srgb, var(--ub-pin) 60%, transparent);
    border-radius: 50%;
    animation: ub-marker-pulse 2s infinite;
  }
  @keyframes ub-marker-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.ub-placement-pin-dot::after) {
      animation: none;
    }
  }
</style>
