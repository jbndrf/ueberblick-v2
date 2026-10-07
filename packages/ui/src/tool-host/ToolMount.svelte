<script lang="ts">
  // Mounts the tool of one form field into the task-sheet slot (`tool` snippet of FormRenderer).
  import { untrack } from 'svelte';
  import type { ToolSlot } from '../form/contract';
  import { localize } from '../form/localize';
  import { m } from '../paraglide/messages.js';
  import { ToolHostError, type ToolHandle, type ToolHost } from './contract';

  interface Props {
    host: ToolHost;
    slot: ToolSlot;
    locale?: string;
  }
  let { host, slot, locale = 'en' }: Props = $props();

  let el: HTMLDivElement | undefined = $state();
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  // The slot object changes with every value; mount again only when the tool or the field changes.
  const toolKey = $derived(slot.field.tool);
  const fieldId = $derived(slot.id);
  let latest: ToolSlot['value'];
  $effect.pre(() => {
    latest = slot.value;
  });

  $effect(() => {
    const node = el;
    if (!node || !toolKey || !fieldId) return;
    return untrack(() => mountTool(node, toolKey));
  });

  function mountTool(node: HTMLElement, toolKey: string): () => void {
    let handle: ToolHandle | undefined;
    let cancelled = false;
    status = 'loading';
    host
      .mountField(node, {
        toolKey,
        field: {
          key: slot.field.key,
          id: slot.id,
          label: localize(slot.field.label, locale),
          type: slot.field.type,
          ...(slot.field.accept === undefined ? {} : { accept: slot.field.accept }),
          ...(slot.field.maxFiles === undefined ? {} : { maxFiles: slot.field.maxFiles }),
        },
        get value() {
          return latest;
        },
        onproduce: (v) => slot.set(v),
        onclear: () => slot.set(null),
      })
      .then((h) => {
        if (cancelled) h.destroy();
        else {
          handle = h;
          status = 'ready';
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        status = 'error';
        if (!(e instanceof ToolHostError)) console.error(e);
      });
    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }
</script>

<div bind:this={el} class="tool"></div>
<p class="hint" role="status">
  {#if status === 'loading'}{m.tool_loading()}{:else if status === 'error'}{m.tool_unavailable()}{/if}
</p>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    gap: var(--ub-space-xs);
  }
  .hint {
    margin: 0;
    font-size: var(--ub-type-size-sm);
    color: var(--ub-color-text-muted);
  }
  .hint:empty {
    display: none;
  }
</style>
