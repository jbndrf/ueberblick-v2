<script lang="ts">
  // "Mit Eltern-Element verketten" (v3 WorkflowSelector :321-340 chip, +page.svelte :2613-2622 hint, MapCanvas
  // `LAYER_RING_CANDIDATE` rings): the chain chip top right, and while it is armed the hint "Tippe auf das
  // Eltern-Element" and a ring on every candidate parent in view. A tap on a ring picks the parent. The rings are map
  // markers of the handle that are buttons (v3 drew them as icon rings on the layer; a marker is a keyboard and
  // screen-reader path to the parent too). With `toggle` false the chain is not optional (the type sits at its parent):
  // it is armed from the start and there is no chip. Opens no sheet and writes nothing.
  import { LAYER } from '../../layers';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Unlink from '@lucide/svelte/icons/unlink';
  import { onDestroy } from 'svelte';
  import type { Bbox, Position } from '@ueberblick/core/geo';
  import type { MapHandle } from '@ueberblick/ui';
  import type { Candidate } from '../../create/chain';
  import { centerOfExtent } from '../../map-view';
  import { message, type Locale } from '../../messages';

  interface Props {
    handle: MapHandle;
    locale: Locale;
    /** The chip is shown (an optional link). False: the parent must be picked and the chain stays armed. */
    toggle: boolean;
    armed: boolean;
    ontoggle: () => void;
    candidates: (extent: Bbox, around: Position) => readonly Candidate[];
    /** The parent picked so far: its ring is filled and the hint goes away. */
    selected?: string | undefined;
    onpick: (parent: Candidate) => void;
  }
  let { handle, locale, toggle, armed, ontoggle, candidates, selected, onpick }: Props = $props();

  // v3's chain colour (indigo): the armed chip, the rings, the dotted line
  const INDIGO = '#6366f1';
  const RING_PX = 44; // a touch target
  const label = $derived(message(locale, 'create_chain'));
  let drawn: string[] = [];

  function ring(c: Candidate, isSelected: boolean): HTMLElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.testid = 'chain-candidate';
    el.setAttribute('aria-label', message(locale, 'create_chain_pick', { name: c.label }));
    el.setAttribute('aria-pressed', String(isSelected));
    el.style.cssText = `width:${RING_PX}px;height:${RING_PX}px;border-radius:50%;padding:0;cursor:pointer;border:3px solid ${INDIGO};background:${isSelected ? 'rgba(99,102,241,.35)' : 'rgba(99,102,241,.12)'};box-shadow:0 0 0 2px rgba(255,255,255,.8)`;
    // a tap on a ring is the pick, never a tap on the map (that would move the pin)
    for (const type of ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup'])
      el.addEventListener(type, (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onpick(c);
    });
    return el;
  }

  function clear(): void {
    for (const id of drawn) handle.removeMarker(id);
    drawn = [];
  }
  function draw(): void {
    clear();
    if (!armed) return;
    const [w, s, e, n] = handle.extent();
    const around = centerOfExtent(handle) ?? [(w + e) / 2, (s + n) / 2];
    for (const [i, c] of candidates([w, s, e, n], around).entries()) {
      const id = `chain-ring-${i}`;
      handle.addMarker(id, c.at, { element: ring(c, c.id === selected) });
      drawn.push(id);
    }
  }
  // drawn again when armed or the pick changes, and when the view settles on another extent (O(candidates in view))
  $effect(() => {
    void armed;
    void selected;
    draw();
    const stop = handle.onExtentChange(draw);
    return () => {
      stop();
      clear();
    };
  });
  onDestroy(clear);
</script>

{#if toggle}
  <button
    type="button"
    data-testid="chain-toggle"
    class={[
      'fixed top-[calc(var(--ub-header-h)+1rem)] right-4 inline-flex size-11 items-center justify-center rounded border border-black/20 bg-white text-[#333] shadow-sm transition-colors hover:bg-[#f4f4f4]',
      LAYER.pill,
    ]}
    style:color={armed ? INDIGO : undefined}
    style:border-left={armed ? `3px solid ${INDIGO}` : undefined}
    title={label}
    aria-label={label}
    aria-pressed={armed}
    onclick={ontoggle}
  >
    {#if armed}<Link2 size={16} />{:else}<Unlink size={16} />{/if}
  </button>
{/if}

{#if armed && selected === undefined}
  <div
    role="status"
    data-testid="chain-hint"
    class={[
      'pointer-events-none fixed top-[calc(var(--ub-header-h)+1rem)] left-1/2 -translate-x-1/2 rounded-full border border-border/50 bg-background/95 px-4 py-2 text-sm font-medium text-foreground shadow-lg backdrop-blur-md',
      LAYER.pill,
    ]}
  >
    {message(locale, 'create_chain_hint')}
  </div>
{/if}
