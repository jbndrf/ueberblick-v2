<script lang="ts">
  // Inside the flow, where `useSvelteFlow` works: turns a screen point into a canvas position (v3 `screenToFlowPosition`,
  // `TaskCanvas.svelte:407`), for a catalog chip dropped on the canvas. It also keeps the graph framed in the area that
  // is visible: the canvas sits between the catalog and the open pane, so when a pane opens or closes (the area
  // resizes) the graph is fitted again, until the person pans or zooms it themselves (WP-472).
  import { onMount } from 'svelte';
  import { useSvelteFlow } from '@xyflow/svelte';

  interface Props {
    /** The element whose size is the visible area. */
    area: HTMLElement | undefined;
    /** The person moved the view: stop fitting. */
    moved: boolean;
  }
  let { area, moved }: Props = $props();

  const flow = useSvelteFlow();
  export function at(x: number, y: number): { x: number; y: number } {
    return flow.screenToFlowPosition({ x, y });
  }

  onMount(() => {
    if (area === undefined || typeof ResizeObserver === 'undefined') return;
    const el = area;
    let last = `${el.clientWidth}x${el.clientHeight}`;
    const watch = new ResizeObserver(() => {
      const now = `${el.clientWidth}x${el.clientHeight}`;
      if (now === last) return;
      last = now;
      if (!moved) void flow.fitView({ duration: 0, minZoom: 0.05 });
    });
    watch.observe(el);
    return () => watch.disconnect();
  });
</script>
