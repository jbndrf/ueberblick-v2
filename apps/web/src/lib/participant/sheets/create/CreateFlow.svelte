<script lang="ts">
  // + : the picker, then (for a point type) the pin or (for a line or an area) the drawing, then the create form.
  // This component only gathers "which task and where"; the form is the task sheet (WP-624), started through `onstart`. Without a map (the list stands in) a point
  // type opens the form at once: the form's geometry field asks for the position itself.
  import { onDestroy } from 'svelte';
  import type { Bbox, Geo, Geometry, Position } from '@ueberblick/core/geo';
  import { DrawOnMap, type MapHandle } from '@ueberblick/ui';
  import type { Candidate, Chain } from '../../create/chain';
  import type { Locale } from '../../messages';
  import type { Pill } from './creatable';
  import CreatePicker from './CreatePicker.svelte';
  import { drawLabels } from './draw-labels';
  import ParentPick from './ParentPick.svelte';
  import PinPlacement from './PinPlacement.svelte';

  interface Props {
    pills: readonly Pill[];
    handle: MapHandle | undefined;
    locale: Locale;
    /** core.geo, which checks a drawn line or area before it is kept. */
    geo: Geo;
    /** The picker is open (the + button toggles it). */
    open: boolean;
    /** Where the picker sits: above the + (centre), or in the left half while Zuletzt takes the right (v3 `position`). */
    position?: 'center' | 'left';
    /** The role has created its quota: the pills are disabled and a hint says why (v3 `quotaReached`). */
    quotaReached?: boolean;
    /** The parents a new object may be chained to, in view (WP-677); absent: no chain is offered. */
    candidatesOf?: (chain: Chain, extent: Bbox, around: Position) => readonly Candidate[];
    /** The host starts what follows (the form); the flow closes nothing itself on a start. `parent` is the chained one. */
    onstart: (taskKey: string, position: Geometry | undefined, parent?: Candidate) => void;
    /** The picker was dismissed, or a placement or drawing was cancelled. */
    onclose: () => void;
    /** The backdrop was tapped (not a pick): the host closes its sibling sheet (Zuletzt) with it. */
    onbackdrop?: () => void;
    /** A pin is being placed or a shape drawn (the bottom bar hides meanwhile, map taps do not close the slot). */
    onplacing?: (placing: boolean) => void;
  }
  let {
    pills,
    handle,
    locale,
    geo,
    open,
    position,
    quotaReached,
    candidatesOf,
    onstart,
    onclose,
    onbackdrop,
    onplacing,
  }: Props = $props();

  let placing: Pill | undefined = $state();
  // a line or an area can only be drawn on the map: without one (the list stands in) those pills are not offered
  const offered = $derived(handle === undefined ? pills.filter((p) => p.draw === undefined) : pills);

  // A pin or a drawing is in progress (v3 `isCreatingInstance`, +page.svelte:1934): the shell lets the map tap place a
  // point of the shape instead of closing the slot (WP-707), and the bottom bar hides meanwhile.
  $effect(() => {
    onplacing?.(placing !== undefined);
  });
  onDestroy(() => onplacing?.(false));

  function select(pill: Pill): void {
    if (quotaReached === true) return;
    if (
      (pill.onMap ||
        pill.draw !== undefined ||
        (pill.chain?.inherit === true && candidatesOf !== undefined)) &&
      handle !== undefined
    ) {
      placing = pill;
      return;
    }
    onstart(pill.taskKey, undefined);
  }
  function confirm(position: Geometry, parent?: Candidate): void {
    if (placing === undefined) return;
    const key = placing.taskKey;
    placing = undefined;
    if (parent === undefined) onstart(key, position);
    else onstart(key, position, parent);
  }
  /** A type at its parent: the picked parent is the whole placement, the form opens at once. */
  function pickParent(parent: Candidate): void {
    if (placing === undefined) return;
    const key = placing.taskKey;
    placing = undefined;
    onstart(key, undefined, parent);
  }
  const candidatesFor = (chain: Chain | undefined) =>
    chain === undefined || candidatesOf === undefined
      ? undefined
      : (extent: Bbox, around: Position) => candidatesOf(chain, extent, around);
  function dismiss(): void {
    onclose();
    onbackdrop?.();
  }
  function cancel(): void {
    placing = undefined;
    onclose();
  }
</script>

{#if placing?.draw !== undefined && handle !== undefined}
  <DrawOnMap
    {handle}
    {geo}
    kind={placing.draw.kind}
    multi={placing.draw.multi}
    labels={drawLabels(locale)}
    onconfirm={confirm}
    oncancel={cancel}
  />
{:else if placing?.chain?.inherit === true && handle !== undefined && candidatesOf !== undefined}
  <ParentPick
    {handle}
    {locale}
    candidates={(extent, around) => candidatesOf(placing?.chain as Chain, extent, around)}
    onpick={pickParent}
    oncancel={cancel}
  />
{:else if placing !== undefined && handle !== undefined}
  {@const candidates = candidatesFor(placing.chain)}
  <PinPlacement
    {handle}
    label={placing.label}
    {locale}
    onconfirm={confirm}
    oncancel={cancel}
    {...candidates === undefined ? {} : { candidates }}
  />
{:else if open}
  <CreatePicker
    pills={offered}
    {locale}
    {...position === undefined ? {} : { position }}
    {...quotaReached === undefined ? {} : { quotaReached }}
    onselect={select}
    onclose={dismiss}
  />
{/if}
