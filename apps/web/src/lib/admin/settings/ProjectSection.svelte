<script lang="ts">
  // One screen for what v3 spread over "Status & Freigabe" and what v4 added as "Template" and "Projektdatei" (owner
  // 2026-10-05): status and publish on top, then the template and its inputs, then the whole project file. The three
  // components are the existing sections, unchanged; this only stacks them.
  import LifecycleSection from './LifecycleSection.svelte';
  import ProjectFileSection from './ProjectFileSection.svelte';
  import TemplateSection from './TemplateSection.svelte';
  import type { SectionProps } from './sections';

  let props: SectionProps = $props();
</script>

<div class="flex w-full flex-col gap-10" data-testid="project-section">
  <LifecycleSection {...props} />
  <TemplateSection {...props} />
  <ProjectFileSection {...props} />
</div>
