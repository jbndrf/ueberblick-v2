<script lang="ts">
  // v3's bottom bar (`BottomControlBar.svelte`): one-thumb access to every map function, mobile only. Layer, Filter,
  // the raised + , Standort, Werkzeuge (only with an active tool) and Einstellungen. It decides nothing: it reports
  // which button was tapped. Flush at the bottom as v3's (`BottomControlBar.svelte:68`, no padding); the home-indicator
  // inset is kept for iOS only: Android Chrome reports an inset for the system navigation bar that is drawn anyway,
  // which doubled it into an empty band (owner, WP-699).
  import { LAYER } from '../layers';
  import Layers from '@lucide/svelte/icons/layers';
  import Filter from '@lucide/svelte/icons/filter';
  import Navigation from '@lucide/svelte/icons/navigation';
  import Settings from '@lucide/svelte/icons/settings';
  import Plus from '@lucide/svelte/icons/plus';
  import Wrench from '@lucide/svelte/icons/wrench';
  import { message, type Locale } from '../messages';
  import { badgeText, NO_BADGE, type ToolBadge } from './badge';
  import { barItems, fabRotation, type BarItem, type FabStep } from './bar';

  interface Props {
    locale: Locale;
    toolsActive: boolean;
    /** Where the + cycle stands: closed, Neu, Neu with Zuletzt. */
    fab: FabStep;
    /** The Werkzeuge badge: a hard count, a soft dot, or none. */
    badge?: ToolBadge;
    onbutton: (item: BarItem) => void;
  }
  let { locale, toolsActive, fab, badge = NO_BADGE, onbutton }: Props = $props();

  const items = $derived(barItems({ toolsActive }));
  const text = (item: Exclude<BarItem, 'create'>): string => message(locale, `bar_${item}`);
  const icons = { layers: Layers, filter: Filter, location: Navigation, tools: Wrench, settings: Settings };
</script>

<!-- Bottom bar with a raised centre button (mobile only) -->
<nav
  aria-label={message(locale, 'bar_label')}
  class={[
    'fixed right-0 bottom-0 left-0 flex items-end justify-around border-t bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 supports-[-webkit-touch-callout:none]:pb-[env(safe-area-inset-bottom)] md:hidden',
    LAYER.bar,
  ]}
>
  {#each items as item (item)}
    {#if item === 'create'}
      <div class="relative flex items-center justify-center">
        <button
          type="button"
          onclick={() => onbutton('create')}
          class="center-button -mt-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg active:scale-95"
          style:transform="rotate({fabRotation(fab)}deg)"
          aria-label={fab === 0 ? message(locale, 'bar_new') : message(locale, 'bar_close_menu')}
        >
          <Plus class="h-6 w-6" />
        </button>
      </div>
    {:else}
      {@const Icon = icons[item]}
      <button
        type="button"
        onclick={() => onbutton(item)}
        class="flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        title={text(item)}
      >
        {#if item === 'tools'}
          <div class="relative">
            <Icon class="h-5 w-5" />
            {#if badge.hard > 0}
              <span
                class="absolute -top-1 -right-2 flex min-w-4 items-center justify-center rounded-full bg-red-700 px-1 text-[0.625rem] leading-4 font-semibold text-white"
                >{badgeText(badge.hard)}</span
              >
            {:else if badge.soft}
              <span class="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-muted-foreground"
                ><span class="sr-only">{message(locale, 'tools_badge_unread')}</span></span
              >
            {/if}
          </div>
        {:else}
          <Icon class="h-5 w-5" />
        {/if}
        <span class="max-w-full truncate text-[0.625rem]">{text(item)}</span>
      </button>
    {/if}
  {/each}
</nav>

<style>
  .center-button {
    transition: transform 0.2s ease;
  }

  .center-button:hover {
    filter: brightness(1.05);
  }

  @media (prefers-reduced-motion: reduce) {
    .center-button {
      transition: none;
    }
  }
</style>
