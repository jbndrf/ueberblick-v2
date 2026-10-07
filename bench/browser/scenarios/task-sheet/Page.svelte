<script lang="ts">
  import Button from '../../../../packages/ui/src/components/Button.svelte';
  import Sheet from '../../../../packages/ui/src/components/Sheet.svelte';
  import TaskSheet from '../../../../packages/ui/src/task-sheet/TaskSheet.svelte';
  import { prepare, taskSheetProps } from '../../lib/task-world';
  import { inpSince, slowdown } from '../../lib/probe';

  let { record }: { record: (ms: number) => void } = $props();
  const world = prepare(50);

  let open = $state(false);
  let props = $state.raw(taskSheetProps(world));

  function onclick(e: Event) {
    props = taskSheetProps(world);
    open = true;
    slowdown();
    void inpSince(e).then(record);
  }
</script>

<Button variant="primary" {onclick}>New task</Button>
<Sheet {open} title="Inspection" onclose={() => (open = false)}>
  <TaskSheet {...props} onclose={() => (open = false)} />
</Sheet>
