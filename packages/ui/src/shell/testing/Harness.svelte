<script lang="ts">
  import AppShell from '../AppShell.svelte';
  import type { AppShellProps } from '../contract';

  // Test harness: real snippets, so the slots update reactively like a consumer's would.
  type Props = Omit<AppShellProps, 'map' | 'taskSheet' | 'me' | 'assistant' | 'featureSheet'> & {
    withAssistant?: boolean;
    withFeature?: boolean;
  };
  let { withAssistant = false, withFeature = false, ...rest }: Props = $props();
</script>

{#snippet map({ viewKey }: { viewKey: string | null })}<p>map:{viewKey}</p>{/snippet}
{#snippet taskSheet({ taskKey }: { taskKey: string })}<p>task:{taskKey}</p>{/snippet}
{#snippet me({ section }: { section: string })}<p>me:{section}</p>{/snippet}
{#snippet assistant()}<p>hi assistant</p>{/snippet}
{#snippet featureSheet({ featureId }: { featureId: string })}<p>feat:{featureId}</p>{/snippet}

<AppShell
  {...rest}
  {map}
  {taskSheet}
  {me}
  assistant={withAssistant ? assistant : undefined}
  featureSheet={withFeature ? featureSheet : undefined}
/>
