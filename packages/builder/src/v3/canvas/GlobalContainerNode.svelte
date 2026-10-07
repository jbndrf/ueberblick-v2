<script lang="ts">
  // v3 `task-canvas/GlobalContainerNode.svelte`: holds the tasks that belong to no stage ("available
  // everywhere"): a stack of task buttons like a stage, but with no entry handle and a dashed border.
  import type { Node, NodeProps } from '@xyflow/svelte';
  import Globe from '@lucide/svelte/icons/globe';
  import { getBuilderContext } from '../shell/context';
  import type { TaskButton } from './model';
  import TaskToolbarList from './TaskToolbarList.svelte';

  type GlobalNodeType = Node<{ tasks: readonly TaskButton[] }, 'global'>;
  let { data }: NodeProps<GlobalNodeType> = $props();
  const ctx = getBuilderContext();
</script>

<div class="global-node" data-global-container>
  <div class="node-header">
    <Globe class="icon muted" />
    <span class="global-title">{ctx.t('canvas_global')}</span>
  </div>
  <TaskToolbarList tasks={data.tasks} scope={null} />
</div>
