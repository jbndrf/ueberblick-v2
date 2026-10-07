<script lang="ts">
  // Test double: an inspector a later work package would register; it reads the frame's context.
  import { getBuilderContext } from './context';
  const ctx = getBuilderContext();
  const selection = $derived(ctx.selection());
</script>

<div data-testid="dummy-inspector">{selection.kind}:{selection.id ?? ''}</div>
