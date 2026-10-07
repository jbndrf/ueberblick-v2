<script lang="ts">
  // `/legal` (v3 legal/+page.svelte): the instance's legal pages as a public list.
  import { onMount } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { message, type Locale } from '../messages';
  import { storedLocale } from './locale';

  // `locale` is what the server chose from Accept-Language; a language chosen on this device wins once mounted.
  let { pages, locale: initial }: { pages: readonly { slug: string; title: string }[]; locale: Locale } =
    $props();
  let chosen: Locale | undefined = $state();
  const locale = $derived(chosen ?? initial);
  onMount(() => {
    chosen = storedLocale();
    document.documentElement.lang = chosen ?? initial;
  });
</script>

<svelte:head><title>{message(locale, 'legal_title')}</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8 sm:py-12">
  <div class="mb-6">
    <Button variant="ghost" size="sm" href="/" class="-ml-2">
      <ArrowLeft class="mr-1 h-4 w-4" />
      {message(locale, 'legal_back')}
    </Button>
  </div>
  <h1 class="mb-6 text-2xl font-semibold">{message(locale, 'legal_title')}</h1>
  {#if pages.length === 0}
    <p class="text-sm text-muted-foreground">{message(locale, 'legal_empty')}</p>
  {:else}
    <ul class="space-y-2">
      {#each pages as page (page.slug)}
        <li>
          <a href={`/legal/${page.slug}`} class="text-primary underline-offset-4 hover:underline">
            {page.title}
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
