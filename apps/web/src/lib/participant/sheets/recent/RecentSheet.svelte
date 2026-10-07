<script module lang="ts">
  // v3 `savedScrollTop` (RecentSheet:4): the list comes back where the person left it, also after the sheet was closed.
  let savedScrollTop = 0;
</script>

<script lang="ts">
  // Zuletzt (v3 RecentSheet): the right-hand sheet with the newest Objekte. A row flies to the Objekt on the map (when
  // it has a position) and opens its sheet; an Objekt without a position opens its sheet only.
  import { LAYER } from '../../layers';
  import * as Sheet from '@ueberblick/ui/components/ui/sheet';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import type { FeatureId, Instant } from '@ueberblick/core/model';
  import { markerSvgUrl } from '@ueberblick/ui';
  import { ago } from '../../feature/ago';
  import { message, type Locale } from '../../messages';
  import type { RecentRow } from './recent';

  interface Props {
    open: boolean;
    rows: readonly RecentRow[];
    locale: Locale;
    /** The clock port's reading, for the relative time. */
    now: Instant;
    /** A detail stands open: on a desktop Zuletzt sits left of its 450 px panel, above it (v3 `besideDetail`). */
    besideDetail?: boolean;
    onopen: (id: FeatureId) => void;
    onclose: () => void;
  }
  let { open, rows, locale, now, besideDetail = false, onopen, onclose }: Props = $props();

  let scrollEl: HTMLDivElement | null = $state(null);
  $effect(() => {
    if (!open || scrollEl === null) return;
    const el = scrollEl;
    // next frame, so the rows have been laid out (v3 :168)
    const frame = requestAnimationFrame(() => (el.scrollTop = savedScrollTop));
    return () => cancelAnimationFrame(frame);
  });
</script>

<Sheet.Root {open} onOpenChange={(o) => !o && onclose()}>
  <!-- Beside the 450 px detail panel it sits to its left (md:right-[450px]) and above it (LAYER.recentBesideDetail); a phone keeps right-0. -->
  <Sheet.ContentNoOverlay
    side="right"
    preventScroll={false}
    class="w-56 p-0 md:w-64 {besideDetail
      ? `md:right-[450px] ${LAYER.recentBesideDetail}`
      : ''} {LAYER.recent}"
    data-testid="recent-sheet"
  >
    <Sheet.Header class="px-4 pt-4 pb-2">
      <Sheet.Title>{message(locale, 'recent_title')}</Sheet.Title>
      <Sheet.Description class="text-xs">{message(locale, 'recent_description')}</Sheet.Description>
    </Sheet.Header>
    <div
      class="flex-1 overflow-y-auto px-3 pb-4"
      data-testid="recent-list"
      bind:this={scrollEl}
      onscroll={() => scrollEl && (savedScrollTop = scrollEl.scrollTop)}
    >
      {#if rows.length === 0}
        <div class="py-8 text-center text-xs text-muted-foreground">{message(locale, 'recent_empty')}</div>
      {:else}
        <ul class="space-y-2">
          {#each rows as row (row.id)}
            {@const when = row.updatedAt === undefined ? '' : ago(row.updatedAt, now, locale)}
            <li>
              <button
                type="button"
                data-testid="recent-row"
                onclick={() => onopen(row.id)}
                class="w-full rounded-lg border bg-background p-2.5 text-left transition-colors hover:bg-accent active:bg-accent/80"
              >
                <div class="flex items-start gap-2">
                  <!-- v3 :222-233: the type's icon, else a dot in its colour. -->
                  {#if row.look.icon !== undefined}
                    <img
                      class="mt-0.5 h-5 w-5 shrink-0"
                      src={markerSvgUrl(row.look, 16)}
                      alt=""
                      width="16"
                      height="16"
                      data-testid="recent-icon"
                    />
                  {:else}
                    <div
                      class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style:background-color={row.look.color}
                      data-testid="recent-dot"
                    ></div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-xs font-medium text-foreground">{row.typeLabel}</div>
                    {#if row.activity !== undefined}
                      <div
                        class="mt-0.5 truncate text-sm font-medium text-foreground"
                        data-testid="recent-activity"
                      >
                        {row.activity}
                      </div>
                    {/if}
                    <div
                      class="mt-0.5 truncate text-sm text-foreground"
                      class:font-medium={row.activity === undefined}
                    >
                      {row.label}
                    </div>
                    <div
                      class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground"
                    >
                      {#if when !== ''}<span data-testid="recent-time">{when}</span>{/if}
                      {#if row.stage !== undefined}
                        {#if when !== ''}<span aria-hidden="true">·</span>{/if}
                        <Badge
                          variant="outline"
                          class="h-4 px-1 py-0 text-[10px] leading-none"
                          data-testid="recent-stage"
                        >
                          {row.stage}
                        </Badge>
                      {/if}
                      {#if !row.hasLocation}
                        {#if when !== '' || row.stage !== undefined}<span aria-hidden="true">·</span>{/if}
                        <span class="italic">{message(locale, 'recent_no_location')}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </Sheet.ContentNoOverlay>
</Sheet.Root>
