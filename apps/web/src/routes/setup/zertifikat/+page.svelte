<script lang="ts">
  import SetupCertificate from './SetupCertificate.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<SetupCertificate locale={data.locale} ca={data.ca} qr={data.qr} pageUrl={data.pageUrl} />
