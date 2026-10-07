<script lang="ts">
  import { TAP_ICON } from './tap';
  // v3's header (`+layout.svelte:532-659`): 56 px, the project icon and name (or the sync progress while data
  // moves), on a desktop the bar's functions as icons, and the account icon that opens Einstellungen.
  import Layers from '@lucide/svelte/icons/layers';
  import Filter from '@lucide/svelte/icons/filter';
  import Plus from '@lucide/svelte/icons/plus';
  import Clock from '@lucide/svelte/icons/clock';
  import Navigation from '@lucide/svelte/icons/navigation';
  import Settings from '@lucide/svelte/icons/settings';
  import Wrench from '@lucide/svelte/icons/wrench';
  import UserCircle from '@lucide/svelte/icons/user-circle';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { message, type Locale } from '../messages';
  import { badgeText, NO_BADGE, type ToolBadge } from './badge';
  import type { BarItem } from './bar';

  interface Props {
    locale: Locale;
    /** The project's name: the deployed `branding.name`, else the project name (the bootstrap's `displayName`, A-036). */
    title: string;
    /** The project icon (`branding.icon`, a blob URL), drawn only as an `<img>`; none shows the app logo. */
    icon?: string | undefined;
    /** Features loaded while a snapshot is pulled; undefined when no data is moving. */
    syncing: number | undefined;
    toolsActive: boolean;
    /** The app-loading message (v3 `appLoadingMessage`): shown, pulsing, in place of the name while the map's objects load. */
    loading?: string | undefined;
    /** The Werkzeuge badge: a hard count, a soft dot, or none (v3 `mapNavBadges`). */
    badge?: ToolBadge;
    onbutton: (item: BarItem | 'recent') => void;
  }
  let { locale, title, icon, syncing, toolsActive, loading, badge = NO_BADGE, onbutton }: Props = $props();
</script>

<header class="flex h-[var(--ub-header-h)] shrink-0 items-center justify-between border-b bg-background px-4">
  <div class="flex items-center gap-2">
    {#if icon}
      <img src={icon} alt="" class="h-8 w-8 rounded-lg object-cover" />
    {:else}
      <img src="/icons/logo-light.png" alt="" class="h-8 w-8 rounded-lg object-contain dark:invert" />
    {/if}
    {#if syncing !== undefined}
      <span class="animate-pulse motion-reduce:animate-none text-sm text-muted-foreground" role="status"
        >{message(locale, 'header_syncing', { count: syncing })}</span
      >
    {:else if loading}
      <span class="animate-pulse motion-reduce:animate-none text-sm text-muted-foreground" role="status"
        >{loading}</span
      >
    {:else}
      <span class="font-semibold">{title}</span>
    {/if}
  </div>

  <!-- Desktop navigation (hidden on mobile, where the bottom bar has the same functions) -->
  <div class="hidden items-center gap-1 md:flex">
    <Button
      variant="ghost"
      size="icon"
      class={TAP_ICON}
      onclick={() => onbutton('layers')}
      title={message(locale, 'header_layers')}
      aria-label={message(locale, 'header_layers')}><Layers class="h-5 w-5" /></Button
    >
    <Button
      variant="ghost"
      size="icon"
      class={TAP_ICON}
      onclick={() => onbutton('filter')}
      title={message(locale, 'bar_filter')}
      aria-label={message(locale, 'bar_filter')}><Filter class="h-5 w-5" /></Button
    >
    <Button
      variant="ghost"
      size="icon"
      class={TAP_ICON}
      onclick={() => onbutton('create')}
      title={message(locale, 'bar_new')}
      aria-label={message(locale, 'bar_new')}><Plus class="h-5 w-5" /></Button
    >
    <Button
      variant="ghost"
      size="icon"
      class={TAP_ICON}
      onclick={() => onbutton('recent')}
      title={message(locale, 'bar_recent')}
      aria-label={message(locale, 'bar_recent')}><Clock class="h-5 w-5" /></Button
    >
    <Button
      variant="ghost"
      size="icon"
      class={TAP_ICON}
      onclick={() => onbutton('location')}
      title={message(locale, 'header_location')}
      aria-label={message(locale, 'header_location')}><Navigation class="h-5 w-5" /></Button
    >
    {#if toolsActive}
      <Button
        variant="ghost"
        size="icon"
        class={TAP_ICON}
        onclick={() => onbutton('tools')}
        title={message(locale, 'bar_tools')}
        aria-label={message(locale, 'bar_tools')}
      >
        <Wrench class="h-5 w-5" />
        {#if badge.hard > 0}
          <span
            class="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-red-700 px-1 text-[0.625rem] leading-4 font-semibold text-white"
            >{badgeText(badge.hard)}</span
          >
        {:else if badge.soft}
          <span class="absolute top-2 right-2 h-2 w-2 rounded-full bg-muted-foreground"
            ><span class="sr-only">{message(locale, 'tools_badge_unread')}</span></span
          >
        {/if}
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      class={TAP_ICON}
      onclick={() => onbutton('settings')}
      title={message(locale, 'bar_settings')}
      aria-label={message(locale, 'bar_settings')}><Settings class="h-5 w-5" /></Button
    >
  </div>

  <Button variant="ghost" size="icon" class={TAP_ICON} onclick={() => onbutton('settings')}>
    <UserCircle class="h-5 w-5" />
    <span class="sr-only">{message(locale, 'account')}</span>
  </Button>
</header>
