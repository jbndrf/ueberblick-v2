<script lang="ts">
  // "noch nicht portiert": stands in for an admin page that a later work package ports (WP-320 contract).
  import { adminMessage } from './messages';
  import { itemForPath } from './nav';
  import type { Locale } from './locale';

  let { locale, pathname }: { locale: Locale; pathname: string } = $props();
  const item = $derived(itemForPath(pathname));
  const title = $derived(item === null ? adminMessage(locale, 'product') : adminMessage(locale, item.label));
</script>

<svelte:head><title>{title} - {adminMessage(locale, 'product')}</title></svelte:head>

<h1 class="mb-2 text-lg font-semibold">{title}</h1>
<p class="text-sm text-muted-foreground">{adminMessage(locale, 'placeholder')}</p>
