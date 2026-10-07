<script lang="ts">
  // A tool of the Werkzeuge sheet (Search, Measure) in its panel: one tap on its tile to open, no third level.
  // The tool only reads or starts a task; it never writes (R3).
  import { LAYER } from './layers';
  import { onDestroy, onMount } from 'svelte';
  import { Portal } from 'bits-ui';
  import X from '@lucide/svelte/icons/x';
  import type { FeatureId } from '@ueberblick/core/model';
  import { browserPosition, createToolHost, iconClose, IconButton, webCryptoHash } from '@ueberblick/ui';
  import * as Sheet from '@ueberblick/ui/components/ui/sheet';
  import type { ToolHandle } from '@ueberblick/ui/tool-api';
  import type { Device } from './device';
  import { message, type Locale } from './messages';
  import type { MapToolPort } from './map-view';
  import { toolLoaders, typeLabelOf } from './tools';
  import { chatDepsOf } from './tools/chat';
  import { manifestOf } from './tools/manifest';
  import type { ToolPerson } from './tools/person';

  interface Props {
    device: Device;
    toolKey: string;
    label: string;
    locale: Locale;
    map: MapToolPort['port'];
    /** The person's switches and preferences; the host then gates the tool and fills `ctx.settings` and `ctx.preferences`. */
    person?: ToolPerson;
    onstartTask: (taskKey: string) => void;
    onopenFeature: (id: FeatureId) => void;
    onclose: () => void;
  }
  let { device, toolKey, label, locale, map, person, onstartTask, onopenFeature, onclose }: Props = $props();

  let el: HTMLDivElement | undefined = $state();
  let failed = $state(false);
  let handle: ToolHandle | undefined;

  $effect(() => {
    const node = el;
    if (node === undefined) return;
    let cancelled = false;
    const host = createToolHost({
      loaders: toolLoaders({
        geo: async () => device.geo,
        primaryGeometry: (t) => device.config.foldTypes.get(t)?.primaryGeometry,
        searchSettings: device.config.file.tools?.['search'] ?? {},
        ...(manifestOf(toolKey)?.data ? { chat: chatDepsOf(device, locale) } : {}),
      }),
      ports: { blobs: device.blobs, hash: webCryptoHash, position: browserPosition },
      locale,
      ...(person === undefined ? {} : { person }),
      // the data streams of the person's tools (`ctx.data`, B-020): a tool that declares `data` gets its own port
      ...(device.toolSource === undefined ? {} : { data: device.toolSource }),
    });
    host
      .mountPanel(node, {
        point: 'tools-sheet',
        toolKey,
        startTask: onstartTask,
        map,
        openFeature: onopenFeature,
        searchText: device.searchText,
        feature: (id) => device.feature(id),
        typeLabel: typeLabelOf(device.config.file, locale),
      })
      .then((h) => (cancelled ? h.destroy() : (handle = h)))
      .catch(() => (failed = !cancelled));
    return () => {
      cancelled = true;
      handle?.destroy();
      handle = undefined;
    };
  });
  onDestroy(() => handle?.destroy());

  // The side panel (v3 `ChatSheet.svelte:344-357`): as high as the visible viewport, so the keyboard does not cover the composer.
  let viewportHeight = $state(window.visualViewport?.height ?? window.innerHeight);
  let panel: HTMLElement | undefined = $state();
  onMount(() => {
    const update = (): void => {
      viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    };
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    // not modal, but focus goes in on open and back to what opened it on close (as the detail shell does)
    const opener = document.activeElement as HTMLElement | null;
    panel?.focus({ preventScroll: true });
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      opener?.focus?.({ preventScroll: true });
    };
  });
  /** The role has no stream for this tool (not offered, or lost while the panel was open). */
  const unavailable = $derived(
    manifestOf(toolKey)?.data === true && device.toolSource?.forTool(toolKey) === undefined,
  );
</script>

{#snippet body()}
  <!-- the mount fills its box, so a tool's `height:100%` resolves (chat's log) -->
  <div bind:this={el} class="h-full"></div>
  {#if failed}<p role="alert">{message(locale, 'task_unknown')}</p>{/if}
{/snippet}

{#if manifestOf(toolKey)?.aside}
  <!-- v3's chat sheet (an `<aside>` there; `role=dialog` is not allowed on one, so a div): a non-modal side panel, full width on a phone and 24rem from md, above the map and the bars -->
  <Portal to="body">
    <div
      bind:this={panel}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      tabindex="-1"
      class={[
        'fixed top-0 right-0 flex w-full flex-col border-l bg-background text-foreground shadow-xl outline-none md:w-96',
        LAYER.top,
      ]}
      style:height="{viewportHeight}px"
      onkeydown={(e) => e.key === 'Escape' && !e.defaultPrevented && onclose()}
    >
      <div class="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <h2 class="text-base font-semibold">{label}</h2>
        <button
          type="button"
          class="flex min-h-11 min-w-11 items-center justify-center rounded p-2 transition-colors hover:bg-muted"
          aria-label={message(locale, 'tools_close')}
          onclick={onclose}
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div class="min-h-0 flex-1">
        {#if unavailable}
          <p class="p-6 text-center text-sm text-muted-foreground">{message(locale, 'chat_not_member')}</p>
        {:else}
          {@render body()}
        {/if}
      </div>
    </div>
  </Portal>
{:else if manifestOf(toolKey)?.readsMapTaps}
  <!-- not modal: no scrim, so a tap on the map above the panel reaches the tool -->
  <div class="panel" role="dialog" aria-label={label}>
    <div class="head">
      <h2>{label}</h2>
      <IconButton icon={iconClose} label={message(locale, 'tools_close')} onclick={onclose} />
    </div>
    {@render body()}
  </div>
{:else}
  <!-- v3's side sheet (as Einstellungen): above the bar, no scrim -->
  <Sheet.Root open={true} onOpenChange={(o) => !o && onclose()}>
    <Sheet.ContentNoOverlay side="right" class="w-80" preventScroll={false}>
      <Sheet.Header>
        <Sheet.Title>{label}</Sheet.Title>
      </Sheet.Header>
      <div class="overflow-y-auto pr-1">{@render body()}</div>
    </Sheet.ContentNoOverlay>
  </Sheet.Root>
{/if}

<style>
  .panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 4rem; /* above the phone's bottom bar (h-16); the desktop has none */
    max-height: 40vh;
    overflow: auto;
    box-sizing: border-box;
    padding: var(--ub-space-md);
    background: var(--ub-color-bg);
    color: var(--ub-color-text);
    border-radius: var(--ub-radius-lg) var(--ub-radius-lg) 0 0;
    box-shadow: var(--ub-elevation-overlay);
  }
  @media (min-width: 768px) {
    .panel {
      bottom: 0;
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ub-space-md);
  }
  h2 {
    margin: 0;
    font-size: var(--ub-type-size-lg);
  }
</style>
