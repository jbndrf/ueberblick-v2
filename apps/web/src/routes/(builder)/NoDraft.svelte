<script lang="ts">
  import { messages } from '@ueberblick/builder';

  let { project, locale }: { project: string; locale: string } = $props();
  const t = $derived(messages(locale));
</script>

<svelte:head><title>{t('title_no_draft', { project })}</title></svelte:head>

<main><p>{t('no_draft')}</p></main>
