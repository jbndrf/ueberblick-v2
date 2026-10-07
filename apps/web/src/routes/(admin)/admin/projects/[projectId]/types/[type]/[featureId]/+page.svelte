<script lang="ts">
  // The Objekt's page (v3 `workflows/[workflowId]/instances/[id]/+page.svelte`): a row of the data page opens here.
  import FeatureDetail from '../../../../../../../../lib/admin/feature/FeatureDetail.svelte';
  import { adminMessage } from '../../../../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{adminMessage(data.locale, 'product')}</title></svelte:head>

{#if data.type}
  {#key data.row.$id}
    <FeatureDetail
      locale={data.locale}
      project={data.project}
      typeKey={data.key}
      type={data.type}
      tasks={data.tasks}
      row={data.row}
      history={data.history}
      names={data.names}
      roleLabels={data.roleLabels}
      basemap={data.basemap}
      backHref="/admin/projects/{data.project}/types/{data.key}"
    />
  {/key}
{/if}
