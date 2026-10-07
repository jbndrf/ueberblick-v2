<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import ProjectCards from '../../../../lib/admin/projects/ProjectCards.svelte';
  import { adminMessage } from '../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{adminMessage(data.locale, 'nav_projects')} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

<ProjectCards
  locale={data.locale}
  projects={data.projects}
  templates={data.templates}
  reload={invalidateAll}
/>
