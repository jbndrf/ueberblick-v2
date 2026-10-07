<script lang="ts">
  import LegalIndex from '$lib/participant/login/LegalIndex.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<LegalIndex pages={data.pages} locale={data.locale} />
