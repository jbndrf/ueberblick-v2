<script lang="ts">
  // v3 `task-canvas/TaskCanvas.svelte`, the read side (WP-334): the Objektart's one process as an
  // abstract flow graph. Stage cards hold their task buttons, the global container holds the tasks
  // without a stage, entry markers and rule nodes sit to the left, arrows go from a task's exit dot
  // to its target stage. Pan and zoom are xyflow's (wheel, pinch, drag); `fitView` frames it on
  // open, as in v3. The graph is derived from the Doc (`model.ts`). Dragging any node moves it and the
  // position is stored next to the draft, not in the config (WP-366, `layout-api.ts`); v3 stored only the
  // stages' (`:466-470`) and lost the other nodes on reload (`posCache`, `:89, 179-194`). Nodes without a
  // stored position keep the automatic arrangement. Clicking the background clears the selection.
  // Editing (WP-435, S4-4): draw an arrow from a button's exit dot to a phase, move its end, Delete removes it;
  // "Phase hinzufügen"; catalog chips dropped on the canvas; the rest (add, reorder, menu, tool icons) is in
  // `state.svelte.ts` and the node components. Everything goes through the builder's ops, so a refusal (a template
  // lock, an arrow that exists) shows as a note below.
  import { onDestroy, onMount } from 'svelte';
  import { Background, MarkerType, SvelteFlow, type Connection, type Edge, type Node } from '@xyflow/svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import '@xyflow/svelte/dist/style.css';
  import { getBuilderContext } from '../shell/context';
  import { arrange, type Point } from './arrange';
  import ActionEdge from './ActionEdge.svelte';
  import './canvas.css';
  import './canvas-edit.css';
  import CanvasMenu from './CanvasMenu.svelte';
  import { setCanvasState } from './context';
  import FlowProjector from './FlowProjector.svelte';
  import { createCanvasState } from './state.svelte';
  import ConfirmDelete from '../task/ConfirmDelete.svelte';
  import { CATALOG_MIME, CATALOG_NODES, CATALOG_TASKS, type CatalogCreate } from '../catalog/ops';
  import EntryMarkerNode from './EntryMarkerNode.svelte';
  import GlobalContainerNode from './GlobalContainerNode.svelte';
  import { createLayoutSaver, getCanvasLayoutApi, pruned, withStored, type LayoutSaver } from './layout-api';
  import { buildCanvas, CANVAS_ORIGINS, nodeId } from './model';
  import RuleNode from './RuleNode.svelte';
  import StageNode from './StageNode.svelte';
  import SubprocessBackLink from './SubprocessBackLink.svelte';

  const ctx = getBuilderContext();
  const nodeTypes = { stage: StageNode, global: GlobalContainerNode, rule: RuleNode, entry: EntryMarkerNode };
  const edgeTypes = { action: ActionEdge };

  const model = $derived(buildCanvas(ctx.doc(), ctx.type, ctx.locale));
  const canvas = setCanvasState(createCanvasState(ctx, () => model));
  let projector: FlowProjector | undefined = $state();
  let area: HTMLElement | undefined = $state();
  let moved = $state(false);

  // The stored positions, loaded before the flow mounts so `fitView` frames the nodes where they are.
  const layoutApi = getCanvasLayoutApi();
  const saver: LayoutSaver | undefined = layoutApi && createLayoutSaver(layoutApi, ctx.type);
  let stored = $state.raw<ReadonlyMap<string, Point>>(new Map());
  let loaded = $state(layoutApi === undefined);
  onMount(() => {
    if (layoutApi === undefined) return;
    layoutApi
      .load(ctx.type)
      .then((list) => (stored = new Map(list.map((n) => [n.id, { x: n.x, y: n.y }]))))
      // Positions are an aid: without them the automatic arrangement shows.
      .catch(() => undefined)
      .finally(() => (loaded = true));
  });
  onDestroy(() => void saver?.flush());

  const arranged = $derived(arrange(model));

  /** A drag ended: remember where every moved node is and save the positions of the nodes that still exist. */
  function onDragEnd({ nodes: moved }: { nodes: Node[] }): void {
    const next = new Map(stored);
    for (const n of moved) next.set(n.id, { x: n.position.x, y: n.position.y });
    stored = next;
    saver?.schedule(pruned(next, new Set(arranged.keys())));
  }

  const built = $derived.by(() => {
    const at = withStored(arranged, stored);
    const pos = (id: string) => at.get(id) ?? { x: 0, y: 0 };
    // Arrows start at a task button's exit dot and end at a phase; an entry marker and a rule have no exit to draw
    // from (the engine puts an entry at the start phase, a rule's arrow follows the task it runs).
    const common = { deletable: false, draggable: true, class: 'nopan' } as const;
    const nodes: Node[] = [
      {
        id: nodeId.global,
        type: 'global',
        position: pos(nodeId.global),
        data: { tasks: model.global },
        connectable: true,
        ...common,
      },
      ...model.stages.map((stage): Node => ({
        id: nodeId.stage(stage.key),
        type: 'stage',
        position: pos(nodeId.stage(stage.key)),
        data: { stage },
        connectable: true,
        ...common,
      })),
      ...model.rules.map((rule): Node => ({
        id: nodeId.rule(rule.key),
        type: 'rule',
        position: pos(nodeId.rule(rule.key)),
        data: { rule },
        connectable: false,
        ...common,
      })),
      ...model.entries.map((entry): Node => ({
        id: nodeId.entry(entry.key),
        type: 'entry',
        position: pos(nodeId.entry(entry.key)),
        data: { entry },
        connectable: false,
        ...common,
      })),
    ];
    const edges: Edge[] = model.arrows.map((a) => ({
      id: a.id,
      type: 'action',
      source: a.source,
      sourceHandle: a.handle,
      target: a.target,
      // A task's arrow can be selected (Enter on the focused arrow), moved at its end and deleted.
      selectable: a.origin === CANVAS_ORIGINS.task,
      focusable: a.origin === CANVAS_ORIGINS.task,
      deletable: a.origin === CANVAS_ORIGINS.task,
      ariaLabel: a.label,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        // v3 `curveOffset`: arrows between the same pair fan out, opposing pairs bulge apart.
        curveOffset: (a.reversed ? 45 : 0) + (a.slot - (a.slots - 1) / 2) * 28,
        origin: a.origin,
        otherwise: a.otherwise,
      },
    }));
    return { nodes, edges };
  });

  /** The model draws the edges again after every edit, so xyflow never keeps one of its own: each gesture is an op, or a note. */
  function onbeforeconnect(c: Connection): false {
    if (c.sourceHandle !== null)
      canvas.connect({ source: c.source, handle: c.sourceHandle, target: c.target });
    return false;
  }
  function onbeforereconnect(next: Edge, old: Edge): false {
    canvas.reconnect(old.id, next.target);
    return false;
  }
  async function onbeforedelete({ edges: gone }: { nodes: Node[]; edges: Edge[] }): Promise<boolean> {
    for (const e of gone) canvas.disconnect(e.id);
    return false;
  }

  /** v3 `onDrop` (3), (4): a catalog chip dropped on the canvas makes the node where it fell, or a button where it fell. */
  function chipOf(event: DragEvent): CatalogCreate | undefined {
    for (const mime of [CATALOG_MIME.node, CATALOG_MIME.task]) {
      const raw = event.dataTransfer?.getData(mime);
      if (raw === undefined || raw === '') continue;
      try {
        const req = JSON.parse(raw) as CatalogCreate;
        if (req.kind === 'node' && CATALOG_NODES.includes(req.node)) return req;
        if (req.kind === 'task' && CATALOG_TASKS.includes(req.task)) return req;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  function onDrop(event: DragEvent): void {
    const req = chipOf(event);
    if (req === undefined) return;
    event.preventDefault();
    if (req.kind === 'task') {
      const el = event.target instanceof Element ? event.target : null;
      const task = el?.closest('[data-task-id]')?.getAttribute('data-task-id') ?? undefined;
      const stage = el?.closest('[data-stage-node]')?.getAttribute('data-stage-node') ?? undefined;
      canvas.dropTaskChip(req.task, {
        ...(task === undefined ? {} : { task }),
        ...(stage === undefined ? {} : { stage }),
      });
      return;
    }
    const made = canvas.create(req);
    const at = projector?.at(event.clientX, event.clientY);
    const id =
      made?.id === undefined
        ? undefined
        : made.kind === 'stage'
          ? nodeId.stage(made.id)
          : made.kind === 'rule'
            ? nodeId.rule(made.id)
            : nodeId.entry(made.id);
    if (id !== undefined && at !== undefined) {
      stored = new Map(stored).set(id, at);
      saver?.schedule(pruned(stored, new Set([...arranged.keys(), id])));
    }
  }
  function onDragOver(event: DragEvent): void {
    const types = event.dataTransfer?.types ?? [];
    if (!types.includes(CATALOG_MIME.node) && !types.includes(CATALOG_MIME.task)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
  }

  const addStageLocked = $derived(canvas.createIsLocked({ kind: 'node', node: 'stage' }));

  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  $effect(() => {
    nodes = built.nodes;
    edges = built.edges;
  });
</script>

<div
  class="canvas-root"
  bind:this={area}
  data-testid="builder-canvas"
  role="application"
  aria-label={ctx.t('canvas_label')}
  ondrop={onDrop}
  ondragover={onDragOver}
>
  <div class="canvas-tools">
    <Button
      size="sm"
      variant="secondary"
      data-testid="canvas-add-stage"
      disabled={addStageLocked}
      title={addStageLocked ? ctx.t('catalog_locked') : undefined}
      onclick={() => canvas.create({ kind: 'node', node: 'stage' })}
    >
      <Plus class="add-icon" />
      {ctx.t('canvas_add_stage')}
    </Button>
    <SubprocessBackLink parents={model.parents} />
  </div>
  {#if loaded}
    <SvelteFlow
      bind:nodes
      bind:edges
      {nodeTypes}
      {edgeTypes}
      fitView
      minZoom={0.05}
      onmoveend={(event) => {
        if (event !== null) moved = true;
      }}
      onnodedragstop={onDragEnd}
      deleteKey={['Backspace', 'Delete']}
      {onbeforeconnect}
      {onbeforereconnect}
      {onbeforedelete}
      proOptions={{ hideAttribution: true }}
      onpaneclick={() => ctx.select({ kind: 'none' })}
    >
      <Background />
      <FlowProjector bind:this={projector} {area} {moved} />
    </SvelteFlow>
  {/if}
  {#if canvas.note !== ''}
    <p class="canvas-note" role="status" data-testid="canvas-note">{canvas.note}</p>
  {/if}
</div>

<CanvasMenu menu={canvas.menu} onclose={() => (canvas.menu = undefined)} />
{#if canvas.confirm !== undefined}
  <ConfirmDelete
    bind:open={canvas.confirmOpen}
    t={ctx.t}
    title={canvas.confirm.title}
    impact={canvas.confirm.impact}
    impactLead={canvas.confirm.lead}
    hide={canvas.confirm.hide !== undefined}
    hideBody={canvas.confirm.hide?.body}
    onconfirm={() => {
      canvas.confirmOpen = false;
      canvas.confirm?.run();
    }}
  />
{/if}
