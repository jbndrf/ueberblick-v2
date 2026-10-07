<script lang="ts">
  import LegalArticle from '$lib/participant/login/LegalArticle.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<LegalArticle page={data.page} locale={data.locale} />
