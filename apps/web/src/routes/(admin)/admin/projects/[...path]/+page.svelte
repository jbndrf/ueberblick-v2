<script lang="ts">
  // A page of a later work package: the sidebar links to v3's URL and the shell shows this until the page lands.
  import { page } from '$app/state';
  import Placeholder from '../../shell/Placeholder.svelte';

  let { data }: { data: { locale: 'de' | 'en' } } = $props();
</script>

<Placeholder locale={data.locale} pathname={page.url.pathname} />
