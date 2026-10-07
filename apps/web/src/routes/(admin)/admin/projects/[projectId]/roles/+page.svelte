<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { createRolesApi } from '../../../../../../lib/admin/roles/api';
  import RolesPage from '../../../../../../lib/admin/roles/RolesPage.svelte';
  import { adminMessage } from '../../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData & { locale: 'de' | 'en' } } = $props();

  const api = $derived(
    createRolesApi({
      project: page.params['projectId'] ?? '',
      language: data.locale,
      fetch: (input, init) => fetch(input, init),
      fallback: adminMessage(data.locale, 'rol_update_error'),
    }),
  );
</script>

<svelte:head>
  <title>{adminMessage(data.locale, 'rol_title')} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

<RolesPage {data} locale={data.locale} {api} reload={invalidateAll} />
