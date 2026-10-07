<script lang="ts">
  // The Projekt-Chat slot (v3 `ChatSheet`, its own `chatSheetOpen` flag, `+page.svelte:188,2764`): a non-modal side
  // panel that stays open under Layer, Filter, Werkzeuge and Einstellungen (the shell never closes it for them; only
  // the + does, `+page.svelte:218,266`). A # chip opens the feature beside it and leaves the chat open. "Im Chat
  // erwähnen" seeds the composer (the seed port) and asks for the panel; this slot uses the request up.
  import { untrack } from 'svelte';
  import { mapToolPort } from '../../map-view';
  import type { SheetProps } from '../../shell/sheets';
  import ToolPanel from '../../ToolPanel.svelte';
  import { toolName } from '../../tools/labels';

  let { ctx, onclose }: SheetProps = $props();
  const { device, locale } = $derived(ctx);

  $effect(() => {
    const link = device.chat;
    untrack(() => link.takeOpenRequest()); // the request that opened this slot
    return link.onOpenRequest(() => void link.takeOpenRequest());
  });
  const { port } = mapToolPort(undefined, { color: '' }); // the chat reads no map
</script>

<ToolPanel
  {device}
  toolKey="chat"
  label={toolName(locale, 'chat')}
  {locale}
  map={port}
  onstartTask={() => undefined}
  onopenFeature={ctx.openFeature}
  {onclose}
/>
