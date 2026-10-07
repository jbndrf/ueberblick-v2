<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { createRelationsApi } from '../../../../../../lib/admin/relations/api';
  import RelationsPage from '../../../../../../lib/admin/relations/RelationsPage.svelte';
  import { adminMessage } from '../../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData & { locale: 'de' | 'en' } } = $props();

  const api = $derived(
    createRelationsApi({
      project: page.params['projectId'] ?? '',
      language: data.locale,
      fetch: (input, init) => fetch(input, init),
      fallback: adminMessage(data.locale, 'rel_update_error'),
    }),
  );
</script>

<svelte:head>
  <title>{adminMessage(data.locale, 'rel_title')} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

<RelationsPage {data} locale={data.locale} {api} reload={invalidateAll} />
