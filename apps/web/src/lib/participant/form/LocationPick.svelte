<script lang="ts">
  // The map side of a location step (v3 detail module :583-606: a point is moved with the draggable pin and the red
  // confirm pill, a line or an area is redrawn with the draw tool). It reuses the + flow's two modes (R1): the pin
  // (`PinPlacement`) for a point property, `DrawOnMap` for a line or an area, in the kind and multi-part form the
  // property declares. Without a position the person gets nothing back: cancel resolves `undefined`.
  import { onMount } from 'svelte';
  import type { Geo, Geometry, Position } from '@ueberblick/core/geo';
  import { bboxOf } from '@ueberblick/core/geo/bbox';
  import { DrawOnMap, type Json, type MapHandle } from '@ueberblick/ui';
  import type { Locale } from '../messages';
  import { drawLabels } from '../sheets/create/draw-labels';
  import type { DrawSpec } from '../sheets/create/creatable';
  import { focusOn } from '../map/focus';
  import PinPlacement from '../sheets/create/PinPlacement.svelte';

  interface Props {
    handle: MapHandle;
    geo: Geo;
    locale: Locale;
    /** The confirm pill: the task's button label (v3 :1591). */
    label: string;
    /** How the property is drawn; undefined for a point. */
    draw: DrawSpec | undefined;
    /** The geometry now on the feature: the pin starts there and the shape is loaded into the draw tool. */
    current?: Json | undefined;
    ondone: (geometry: Json | undefined) => void;
  }
  let { handle, geo, locale, label, draw, current, ondone }: Props = $props();
  // The map goes to the feature that is being moved or redrawn, unless it is comfortably in view already (WP-730).
  onMount(() => {
    const g = current as unknown as Geometry | undefined;
    if (g === undefined) return;
    const target = g.type === 'Point' ? (g.coordinates as Position) : bboxOf(g);
    if (target !== undefined) focusOn(handle, target);
  });
  const done = (g: Geometry | undefined): void => ondone(g as Json | undefined);
</script>

{#if draw !== undefined}
  <DrawOnMap
    {handle}
    {geo}
    kind={draw.kind}
    multi={draw.multi}
    labels={drawLabels(locale)}
    {...current === undefined ? {} : { initial: current as unknown as Geometry }}
    onconfirm={done}
    oncancel={() => done(undefined)}
  />
{:else}
  <PinPlacement
    {handle}
    {label}
    {locale}
    {...current === undefined ? {} : { initial: current as unknown as Geometry }}
    onconfirm={done}
    oncancel={() => done(undefined)}
  />
{/if}
