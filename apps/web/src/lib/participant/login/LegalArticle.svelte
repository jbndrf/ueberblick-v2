<script lang="ts">
  // `/legal/<slug>` (v3 legal/[slug]/+page.svelte): one legal page, its HTML sanitised.
  import { onMount } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { message, type Locale } from '../messages';
  import { storedLocale } from './locale';
  import { sanitizeHtml } from './sanitize-html';

  let { page, locale: initial }: { page: { slug: string; title: string; body: string }; locale: Locale } =
    $props();
  let chosen: Locale | undefined = $state();
  const locale = $derived(chosen ?? initial);
  onMount(() => {
    chosen = storedLocale();
    document.documentElement.lang = chosen ?? initial;
  });
</script>

<svelte:head><title>{page.title}</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8 sm:py-12">
  <div class="mb-6">
    <Button variant="ghost" size="sm" href="/" class="-ml-2">
      <ArrowLeft class="mr-1 h-4 w-4" />
      {message(locale, 'legal_back')}
    </Button>
  </div>
  <!-- v3 shows only the body (which usually opens with its own heading); the title stays for screen readers. -->
  <h1 class="sr-only">{page.title}</h1>
  <article class="break-words">{@html sanitizeHtml(page.body)}</article>
</main>
