<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { createInstanceApi } from '../../../../lib/admin/instance/api';
  import InstancePage from '../../../../lib/admin/instance/InstancePage.svelte';
  import { adminMessage } from '../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const api = $derived(
    createInstanceApi({
      fetch: (input, init) => fetch(input, init),
      messages: {
        slugTaken: adminMessage(data.locale, 'inst_slug_taken'),
        slugInvalid: adminMessage(data.locale, 'inst_slug_invalid'),
      },
    }),
  );
</script>

<svelte:head>
  <title>{adminMessage(data.locale, 'inst_title')} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

<InstancePage settings={data.settings} pages={data.pages} locale={data.locale} {api} reload={invalidateAll} />
