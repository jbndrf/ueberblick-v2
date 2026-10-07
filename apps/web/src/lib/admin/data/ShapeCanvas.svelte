<script lang="ts">
  // The drawn Standort: the project's base layer as plain tiles under the shape to scale (v3 `GeometryPreview.svelte`).
  // Used by the table's hover card and the detail page's location pane, so a shape is drawn in one place only.
  import type { PreviewShape } from './geometry-svg';
  import type { UnderlayTile } from './tile-underlay';

  let {
    shape,
    tiles,
    width,
    height,
    alt,
  }: { shape: PreviewShape; tiles: readonly UnderlayTile[]; width: number; height: number; alt: string } =
    $props();
</script>

{#each tiles as tile (tile.src)}
  <img
    src={tile.src}
    alt=""
    aria-hidden="true"
    draggable="false"
    referrerpolicy="no-referrer"
    class="pointer-events-none absolute max-w-none"
    style="left: {tile.left}px; top: {tile.top}px; width: {tile.size}px; height: {tile.size}px"
  />
{/each}
<svg
  class="relative text-primary"
  data-underlay={tiles.length}
  {width}
  {height}
  viewBox="0 0 {width} {height}"
  role="img"
  aria-label={alt}
>
  {#each shape.areas as d, i (i)}
    <path {d} fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" />
  {/each}
  {#each shape.paths as d, i (i)}
    <path {d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  {/each}
  {#each shape.points as [x, y], i (i)}
    <circle cx={x} cy={y} r="6" fill="currentColor" fill-opacity="0.7" />
  {/each}
</svg>
