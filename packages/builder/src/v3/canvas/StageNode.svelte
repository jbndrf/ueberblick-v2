<script lang="ts">
  // v3 `task-canvas/StageNode.svelte`: a stage card. A header (type icon + the stage's label, which
  // renames in place on a click) and the stack of its task buttons. Arrows land on its one entry
  // handle; it has no exit of its own, each task button carries its own. Left border colour = type:
  // start green, end pink, otherwise blue.
  import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
  import CircleStop from '@lucide/svelte/icons/circle-stop';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import { getBuilderContext } from '../shell/context';
  import { getCanvasState } from './context';
  import InlineEdit from './InlineEdit.svelte';
  import { STAGE_KINDS, type StageCard } from './model';
  import { stageOps } from '../stage/ops';
  import TaskToolbarList from './TaskToolbarList.svelte';
  import ProvenanceMark from '../shared/ProvenanceMark.svelte';
  import { ELEMENT_KINDS } from '../shared/provenance-elements';
  import { infoOf } from './provenance';

  type StageNodeType = Node<{ stage: StageCard }, 'stage'>;
  let { data }: NodeProps<StageNodeType> = $props();

  const ctx = getBuilderContext();
  const canvas = getCanvasState();
  const stage = $derived(data.stage);
  const selected = $derived(ctx.selection().kind === 'stage' && ctx.selection().id === stage.key);
  const info = $derived(infoOf(ctx, { kind: ELEMENT_KINDS.stage, key: stage.key }));

  function rename(text: string): void {
    const op = stageOps.rename(ctx.doc().effective(), ctx.type, stage.key, ctx.locale, text);
    if (op !== undefined) ctx.apply(op);
  }
  function onkeydown(e: KeyboardEvent): void {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.select({ kind: 'stage', id: stage.key });
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="stage-node {stage.kind}"
  class:selected
  data-stage-node={stage.key}
  role="group"
  tabindex="0"
  aria-current={selected ? 'true' : undefined}
  aria-label={stage.label}
  onclick={() => ctx.select({ kind: 'stage', id: stage.key })}
  oncontextmenu={(e) =>
    canvas.openMenu(e, ctx.t('canvas_menu_label', { name: stage.label }), canvas.stageMenu(stage.key))}
  {onkeydown}
>
  <Handle type="target" position={Position.Left} class="entry-dot" />
  <div class="node-header">
    {#if stage.kind === STAGE_KINDS.start}
      <span title={ctx.t('canvas_stage_start')}><Play class="icon accent" /></span>
    {:else if stage.kind === STAGE_KINDS.end}
      <span title={ctx.t('canvas_stage_end')}><CircleStop class="icon accent" /></span>
    {:else}
      <Square class="icon accent" />
    {/if}
    <InlineEdit
      class="stage-title"
      value={stage.label}
      editTitle={ctx.t('canvas_rename_stage')}
      oncommit={rename}
    />
    {#if info !== undefined}<ProvenanceMark t={ctx.t} {info} compact />{/if}
  </div>
  <TaskToolbarList tasks={stage.tasks} scope={stage.key} />
</div>
