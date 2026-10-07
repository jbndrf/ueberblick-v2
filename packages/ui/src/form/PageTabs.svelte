<script lang="ts">
  // The tab strip of a multi-page form with v3's red "{count} fehlen" badge per page
  // (reference FormFillTool.svelte:358-382). Tabs jump freely: "Weiter" is never stricter than the tabs.
  import * as Tabs from '../components/ui/tabs';
  import { m } from '../paraglide/messages.js';

  interface Props {
    /** One entry per page: its title and how many required values or invalid values are open. */
    pages: readonly { title: string; missing: number }[];
    current: number;
    onselect: (page: number) => void;
  }
  let { pages, current, onselect }: Props = $props();
</script>

<Tabs.Root value={String(current)} onValueChange={(v) => onselect(Number(v))} class="mb-4">
  <Tabs.List class="w-full flex-nowrap overflow-x-auto" aria-label={m.form_pages()}>
    {#each pages as p, i (i)}
      <Tabs.Trigger value={String(i)} class="text-xs whitespace-nowrap">
        <span>{p.title}</span>
        {#if p.missing > 0}
          <span
            class="ml-1.5 inline-flex items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-white"
            role="img"
            aria-label={m.form_tab_missing_label({ count: p.missing })}
          >
            {p.missing}
          </span>
        {/if}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>
</Tabs.Root>
