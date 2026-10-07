<script lang="ts">
  import TaskSheet from '../TaskSheet.svelte';
  import type { TaskSheetProps } from '../contract';
  import type { Json } from '../../form/contract';

  // Test harness: a real tool snippet that produces a fixed value, like a tool of WP-527 would.
  let props: Omit<TaskSheetProps, 'tool'> = $props();
</script>

{#snippet tool({ field, produce }: { field: { key: string }; produce: (v: Json) => void })}
  <button
    type="button"
    data-tool={field.key}
    onclick={() => produce([{ sha256: 'IMG-1', name: 'a.jpg', mime: 'image/jpeg' }])}>use tool</button
  >
{/snippet}

<TaskSheet {...props} {tool} />
