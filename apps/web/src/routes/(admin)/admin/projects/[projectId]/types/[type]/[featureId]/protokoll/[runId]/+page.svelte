<script lang="ts">
  // The Protokoll of one past run (owner A3): opened from an Aktivität entry of the Objekt's page.
  import ProtokollView from '$lib/admin/feature/ProtokollView.svelte';
  import { adminMessage } from '../../../../../../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{adminMessage(data.locale, 'product')}</title></svelte:head>

<ProtokollView
  locale={data.locale}
  project={data.project}
  protokoll={data.protokoll}
  names={data.names}
  backHref="/admin/projects/{data.project}/types/{data.key}/{data.featureId}"
/>
