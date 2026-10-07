<script lang="ts">
  // The section frame (v3 `settings/SettingsSection.svelte`): title, description, an optional actions slot beside them.
  import type { Snippet } from 'svelte';

  let {
    name,
    description,
    actions,
    children,
  }: {
    name: string;
    description?: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="flex w-full max-w-3xl flex-col gap-4" data-testid="settings-section">
  <header class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <h2 class="text-xl font-semibold tracking-tight">{name}</h2>
      {#if description}
        <p class="mt-1 text-sm text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="shrink-0">{@render actions()}</div>
    {/if}
  </header>
  {@render children()}
</section>
