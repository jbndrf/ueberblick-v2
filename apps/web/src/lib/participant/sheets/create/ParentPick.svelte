<script lang="ts">
  // A type that sits at its parent (B-019, v3 `skipPlacement` / `childSkipsPlacement`, +page.svelte:2161-2166) has no
  // pin: its position is the parent's. v3 skipped the placement when a child was created from its parent; from the +
  // there is no parent yet, so the person taps it on the map: the same hint and rings as "Mit Eltern-Element verketten",
  // armed from the start (no chip: this link is not optional), and the tap starts the form with the parent linked.
  import { LAYER } from '../../layers';
  import type { Bbox, Position } from '@ueberblick/core/geo';
  import type { MapHandle } from '@ueberblick/ui';
  import type { Candidate } from '../../create/chain';
  import { message, type Locale } from '../../messages';
  import ChainLink from './ChainLink.svelte';

  interface Props {
    handle: MapHandle;
    locale: Locale;
    candidates: (extent: Bbox, around: Position) => readonly Candidate[];
    onpick: (parent: Candidate) => void;
    oncancel: () => void;
  }
  let { handle, locale, candidates, onpick, oncancel }: Props = $props();
</script>

<ChainLink {handle} {locale} toggle={false} armed={true} ontoggle={() => {}} {candidates} {onpick} />

<div
  class={[
    'fixed bottom-20 left-1/2 flex -translate-x-1/2 items-center rounded-full bg-destructive px-5 py-3 text-white shadow-lg lg:bottom-8',
    LAYER.pill,
  ]}
>
  <button type="button" data-testid="placement-cancel" class="min-h-6 font-semibold" onclick={oncancel}
    >{message(locale, 'create_cancel')}</button
  >
</div>
