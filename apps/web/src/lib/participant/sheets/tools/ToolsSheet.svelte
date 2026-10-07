<script lang="ts">
  // Werkzeuge (v3 `ToolsSheet.svelte`): a narrow right-hand sheet, no overlay (the map stays usable), one square tile
  // per active tool. A tile closes the sheet and opens its tool. v3's only tile was project chat, with a badge for
  // unread messages (hard count, "99+", or a soft dot); a tile here may carry the same `badge` (no tool uses it yet,
  // chat is step 5).
  import { LAYER } from '../../layers';
  import * as Sheet from '@ueberblick/ui/components/ui/sheet';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { message, type Locale } from '../../messages';
  import { toolIcon } from '../../tools/icons';

  export interface Tile {
    readonly key: string;
    readonly label: string;
    /** Icon name of the manifest. */
    readonly icon: string;
    readonly badge?: { readonly hard: number; readonly soft: boolean };
  }

  interface Props {
    open: boolean;
    tiles: readonly Tile[];
    locale: Locale;
    onopen: (key: string) => void;
  }
  let { open = $bindable(), tiles, locale, onopen }: Props = $props();

  function pick(key: string): void {
    open = false;
    onopen(key);
  }
</script>

<Sheet.Root bind:open>
  <!-- Not modal (v3): preventScroll off keeps `pointer-events` on the page, so the bar and map take taps (WP-656). -->
  <Sheet.ContentNoOverlay side="right" class="w-28 gap-0 p-0 md:w-32 {LAYER.panel}" preventScroll={false}>
    <Sheet.Header class="border-b p-2">
      <Sheet.Title class="text-sm">{message(locale, 'tools_sheet_title')}</Sheet.Title>
    </Sheet.Header>

    <div class="flex flex-col gap-2 p-2">
      {#each tiles as tile (tile.key)}
        {@const Icon = toolIcon(tile.icon)}
        <button
          type="button"
          onclick={() => pick(tile.key)}
          class="relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border bg-card p-1 text-center transition-colors hover:bg-muted active:scale-[0.98]"
        >
          <div
            class="relative flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Icon class="h-4 w-4" />
            {#if tile.badge?.soft && tile.badge.hard === 0}
              <span
                aria-label={message(locale, 'tools_badge_unread')}
                role="img"
                class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-muted-foreground"
              ></span>
            {/if}
          </div>
          <span class="text-[0.625rem] leading-tight font-medium">{tile.label}</span>
          {#if tile.badge !== undefined && tile.badge.hard > 0}
            <Badge
              variant="destructive"
              class="absolute top-1 right-1 h-4 min-w-4 bg-red-700 px-1 text-[0.5625rem] text-white"
            >
              {tile.badge.hard > 99 ? '99+' : tile.badge.hard}
            </Badge>
          {/if}
        </button>
      {:else}
        <div class="rounded-lg border border-dashed p-2 text-center text-[0.625rem] text-muted-foreground">
          {message(locale, 'tools_empty')}
        </div>
      {/each}
    </div>
  </Sheet.ContentNoOverlay>
</Sheet.Root>
