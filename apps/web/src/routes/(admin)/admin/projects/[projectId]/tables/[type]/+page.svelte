<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { createTablesApi } from '../../../../../../../lib/admin/tables/api';
  import TablePage from '../../../../../../../lib/admin/tables/TablePage.svelte';
  import { notifyDraftChanged } from '../../../../../../../lib/admin/draft/status-store.svelte';
  import { adminMessage } from '../../../../shell/messages';
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
  <title>{data.summary.label} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

{#key data.key}
  <TablePage {data} locale={data.locale} {api} reload={invalidateAll} draftChanged={notifyDraftChanged} />
{/key}
