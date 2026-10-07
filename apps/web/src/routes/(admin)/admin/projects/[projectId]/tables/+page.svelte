<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { createTablesApi } from '../../../../../../lib/admin/tables/api';
  import TablesOverview from '../../../../../../lib/admin/tables/TablesOverview.svelte';
  import { notifyDraftChanged } from '../../../../../../lib/admin/draft/status-store.svelte';
  import { adminMessage } from '../../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData & { locale: 'de' | 'en' } } = $props();

  const api = $derived(
    createTablesApi({
      project: data.project,
      language: data.locale,
      fetch: (input, init) => fetch(input, init),
      fallback: adminMessage(data.locale, 'tbl_update_error'),
    }),
  );
</script>

<svelte:head>
  <title>{adminMessage(data.locale, 'tbl_title')} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

<TablesOverview
  {data}
  locale={data.locale}
  project={data.project}
  {api}
  reload={invalidateAll}
  open={(href) => void goto(href)}
  draftChanged={notifyDraftChanged}
/>
