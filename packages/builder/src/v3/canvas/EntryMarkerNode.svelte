<script lang="ts">
  // v3 `task-canvas/EntryMarkerNode.svelte`: "features begin here". One marker per entry task (a
  // task offered from the map that creates this feature type); its exit dot leads to the start
  // stage. Click selects the task. Its label is the task's label, so it renames with it.
  import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
  import LogIn from '@lucide/svelte/icons/log-in';
  import ProvenanceMark from '../shared/ProvenanceMark.svelte';
  import { ELEMENT_KINDS } from '../shared/provenance-elements';
  import { infoOf } from './provenance';
  import { getBuilderContext } from '../shell/context';
  import { getCanvasState } from './context';
  import type { EntryMarker } from './model';

  type EntryNodeType = Node<{ entry: EntryMarker }, 'entry'>;
  let { data }: NodeProps<EntryNodeType> = $props();
  const ctx = getBuilderContext();
  const canvas = getCanvasState();
  const entry = $derived(data.entry);
  const selected = $derived(ctx.selection().kind === 'task' && ctx.selection().id === entry.key);
  const select = (): void => ctx.select({ kind: 'task', id: entry.key });
  const info = $derived(infoOf(ctx, { kind: ELEMENT_KINDS.task, key: entry.key }));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="entry-node"
  class:selected
  data-task-id={entry.key}
  role="group"
  tabindex="0"
  aria-current={selected ? 'true' : undefined}
  aria-label={entry.label}
  oncontextmenu={(e) =>
    canvas.openMenu(e, ctx.t('canvas_menu_label', { name: entry.label }), canvas.entryMenu(entry.key))}
  onclick={(e) => {
    e.stopPropagation();
    select();
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select();
    }
  }}
>
  <LogIn class="icon entry-icon" />
  <span class="entry-label">{entry.label}</span>
  {#if info !== undefined}<ProvenanceMark t={ctx.t} {info} compact />{/if}
  <Handle type="source" id={entry.key} position={Position.Right} class="exit-dot entry" />
</div>
