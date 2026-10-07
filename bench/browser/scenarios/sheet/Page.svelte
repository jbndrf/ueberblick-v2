<script lang="ts">
  import Button from '../../../../packages/ui/src/components/Button.svelte';
  import Sheet from '../../../../packages/ui/src/components/Sheet.svelte';
  import FormRenderer from '../../../../packages/ui/src/form/FormRenderer.svelte';
  import { newSession, prepare } from '../../lib/task-world';
  import { inpSince, slowdown } from '../../lib/probe';

  let { record }: { record: (ms: number) => void } = $props();
  const world = prepare(12);

  let open = $state(false);
  let session = $state.raw(newSession(world));

  function onclick(e: Event) {
    // A fresh session per open, like starting a task.
    session = newSession(world);
    open = true;
    slowdown();
    void inpSince(e).then(record);
  }
</script>

<Button variant="primary" {onclick}>New task</Button>
<Sheet {open} title="Inspection" onclose={() => (open = false)}>
  <FormRenderer {session} onsubmit={() => (open = false)} />
</Sheet>
