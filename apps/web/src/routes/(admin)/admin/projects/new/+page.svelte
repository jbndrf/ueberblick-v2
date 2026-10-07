<script lang="ts">
  import { goto } from '$app/navigation';
  import { createProject, type FormProblems } from '../../../../../lib/admin/projects/create-client';
  import NewProjectForm from '../../../../../lib/admin/projects/NewProjectForm.svelte';
  import { adminMessage } from '../../shell/messages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  // svelte-ignore state_referenced_locally
  let values = $state({ name: '', description: '', template: data.defaultTemplate });
  let problems = $state<FormProblems>({});
  let working = $state(false);

  /** v3 redirected to the new project's Teilnehmende page after creating it. */
  async function submit(): Promise<void> {
    working = true;
    const result = await createProject(values);
    if (result.ok) {
      await goto(`/admin/projects/${result.key}/participants`);
      return;
    }
    problems = result.problems;
    working = false;
  }
</script>

<svelte:head>
  <title>{adminMessage(data.locale, 'project_new_title')} - {adminMessage(data.locale, 'product')}</title>
</svelte:head>

<NewProjectForm
  locale={data.locale}
  templates={data.templates}
  bind:values
  {problems}
  {working}
  onsubmit={submit}
/>
