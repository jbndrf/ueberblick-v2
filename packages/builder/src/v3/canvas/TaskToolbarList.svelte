<script lang="ts">
  // v3 `task-canvas/TaskToolbarList.svelte`: the stack of task buttons inside a stage card or the
  // global container. One button per task: a grip (drag to reorder the buttons of the scope), its label,
  // its tool icons (drag one onto another button to move it, Alt copies) and one exit dot (the source
  // handle, id = task key) from which its arrow to the target stage leaves; at the end "Button hinzufügen".
  // Click selects the task (the right pane opens), double-click or F2 renames its label in place, the
  // right-click menu copies the key or deletes the task. A sub-process task adds the 'verknüpft' link to the
  // child's builder (S4-5). Keyboard: Alt+ArrowUp/Down moves a button, Space on
  // a tool icon picks it up and Enter on a button drops it (Alt copies), the context key opens the menu.
  import { Handle, Position } from '@xyflow/svelte';
  import { tick } from 'svelte';
  import FileText from '@lucide/svelte/icons/file-text';
  import GitBranchPlus from '@lucide/svelte/icons/git-branch-plus';
  import ProvenanceMark from '../shared/ProvenanceMark.svelte';
  import { ELEMENT_KINDS } from '../shared/provenance-elements';
  import { infoOf } from './provenance';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Zap from '@lucide/svelte/icons/zap';
  import { getBuilderContext } from '../shell/context';
  import { getCanvasState } from './context';
  import { startDrag, type DragPayload, type DragTarget } from './drag';
  import InlineEdit from './InlineEdit.svelte';
  import { TOOL_KINDS, type TaskButton } from './model';
  import { renameTaskOp } from './rename';

  interface Props {
    tasks: readonly TaskButton[];
    /** The phase these buttons belong to; `null` is the global container. */
    scope: string | null;
  }
  let { tasks, scope }: Props = $props();

  const ctx = getBuilderContext();
  const canvas = getCanvasState();
  let renaming = $state<string | undefined>(undefined);

  const selected = (key: string): boolean => ctx.selection().kind === 'task' && ctx.selection().id === key;
  const infoOfTask = (key: string) => infoOf(ctx, { kind: ELEMENT_KINDS.task, key });
  const scopeAttr = $derived(scope ?? '');
  const toolIcons = { [TOOL_KINDS.form]: FileText, [TOOL_KINDS.edit]: Pencil, [TOOL_KINDS.location]: MapPin };

  function onkey(e: KeyboardEvent, key: string): void {
    if (e.target !== e.currentTarget) return;
    if (canvas.carried !== undefined) {
      if (e.key === 'Enter') {
        e.preventDefault();
        canvas.drop(key, e.altKey || e.ctrlKey || e.metaKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        canvas.cancelCarry();
      }
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      canvas.nudge(scope, key, e.key === 'ArrowUp' ? -1 : 1);
      // The button keeps focus after the canvas redraws it in its new place.
      void tick().then(() =>
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(`[data-task-id="${key}"][data-scope="${scopeAttr}"]`)?.focus(),
        ),
      );
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ctx.select({ kind: 'task', id: key });
    } else if (e.key === 'F2') {
      e.preventDefault();
      renaming = key;
    }
  }

  function toolKey(e: KeyboardEvent, task: string, index: number, kind: TaskButton['tools'][number]): void {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (canvas.carried?.task === task && canvas.carried.index === index) canvas.cancelCarry();
      else canvas.pickUp(task, index, kind);
    } else if (e.key === 'Escape' && canvas.carried !== undefined) {
      e.preventDefault();
      canvas.cancelCarry();
    }
  }

  /** A drag ended: reorder when it came from a grip and ended on a button of the same scope; else move or copy the tool. */
  function dropped(payload: DragPayload, target: DragTarget | undefined, copy: boolean): void {
    if (target === undefined) return;
    if (payload.kind === 'reorder') {
      // On a button: before it; on "Button hinzufügen": last (v3 `reorderWithin`, dropped on the container).
      if (target.scope === payload.scope)
        canvas.reorder(scope, payload.task, target.task === '' ? null : target.task);
    } else if (target.task !== '') {
      canvas.dropTool(payload.task, payload.index, target.task, copy);
    }
  }
</script>

<div class="toolbar-list">
  {#each tasks as task (task.key)}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="toolbar"
      class:selected={selected(task.key)}
      class:automatic={task.automatic}
      title={task.automatic ? ctx.t('canvas_auto_only') : undefined}
      class:carry-target={canvas.carried !== undefined && canvas.carried.task !== task.key}
      data-task-id={task.key}
      data-scope={scopeAttr}
      role="group"
      tabindex="0"
      aria-current={selected(task.key) ? 'true' : undefined}
      aria-label={task.label}
      oncontextmenu={(e) =>
        canvas.openMenu(e, ctx.t('canvas_menu_label', { name: task.label }), canvas.taskMenu(task.key))}
      onclick={(e) => {
        e.stopPropagation();
        if (canvas.carried !== undefined) canvas.drop(task.key, e.altKey || e.ctrlKey || e.metaKey);
        else ctx.select({ kind: 'task', id: task.key });
      }}
      onkeydown={(e) => onkey(e, task.key)}
    >
      <span
        class="grip nodrag nopan"
        role="button"
        tabindex="-1"
        title={ctx.t('canvas_reorder')}
        aria-label={ctx.t('canvas_reorder')}
        onpointerdown={(e) => {
          e.stopPropagation();
          startDrag(e, { kind: 'reorder', task: task.key, scope: scopeAttr }, { onDrop: dropped });
        }}
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          e.stopPropagation();
          canvas.nudge(scope, task.key, e.key === 'ArrowUp' ? -1 : 1);
        }}
      >
        <GripVertical class="grip-icon" />
      </span>
      {#if task.spawns}
        <span role="img" title={ctx.t('canvas_spawns')} aria-label={ctx.t('canvas_spawns')}>
          <GitBranchPlus class="icon spawns" />
        </span>
      {/if}
      <InlineEdit
        class="toolbar-label"
        value={task.label}
        trigger="dblclick"
        editTitle={ctx.t('canvas_rename_task')}
        bind:editing={() => renaming === task.key, (v) => (renaming = v ? task.key : undefined)}
        oncommit={(text) => ctx.apply(renameTaskOp(ctx.doc().effective(), task.key, ctx.locale, text))}
      />
      {#if task.automatic}
        <span class="auto-mark" data-testid="task-automatic">
          <Zap class="icon rule-icon" />
          <span class="badge">{ctx.t('canvas_auto')}</span>
        </span>
      {/if}
      {#each [infoOfTask(task.key)] as info (task.key)}
        {#if info !== undefined}<ProvenanceMark t={ctx.t} {info} compact />{/if}
      {/each}
      <div class="tools">
        {#each task.tools as tool, index (index)}
          {@const Icon = toolIcons[tool]}
          <span
            class="tool nodrag nopan"
            class:carried={canvas.carried?.task === task.key && canvas.carried.index === index}
            role="button"
            tabindex="0"
            data-tool-index={index}
            title={canvas.toolLabel(tool)}
            aria-label={ctx.t('canvas_tool_label', { tool: canvas.toolLabel(tool), task: task.label })}
            oncontextmenu={(e) =>
              canvas.openMenu(e, canvas.toolLabel(tool), canvas.toolMenu(task.key, index))}
            onpointerdown={(e) => {
              e.stopPropagation();
              startDrag(e, { kind: 'tool', task: task.key, index, tool }, { onDrop: dropped });
            }}
            onclick={(e) => {
              e.stopPropagation();
              ctx.select({ kind: 'task', id: task.key });
            }}
            onkeydown={(e) => toolKey(e, task.key, index, tool)}
          >
            <Icon class="tool-icon" />
          </span>
        {/each}
        {#if task.tools.length === 0}<span class="no-tools">{ctx.t('canvas_no_tools')}</span>{/if}
      </div>
      {#if task.child !== undefined && ctx.typeHref !== undefined}
        <a
          class="subprocess-link nodrag"
          href={ctx.typeHref(task.child.type)}
          data-subprocess-link={task.child.type}
          title={ctx.t('canvas_open_subprocess', { name: task.child.label })}
          onclick={(e) => e.stopPropagation()}
        >
          <Link2 class="tool-icon" />
          {ctx.t('canvas_linked')}: {task.child.label}
        </a>
      {/if}
      <Handle
        type="source"
        id={task.key}
        position={Position.Right}
        class="exit-dot {task.transitions ? 'transition' : ''}"
      />
    </div>
  {/each}
  <button
    type="button"
    class="add-task nodrag nopan"
    data-add-task
    data-scope={scopeAttr}
    onclick={(e) => {
      e.stopPropagation();
      canvas.addTask(scope);
    }}
  >
    <Plus class="add-icon" />
    {ctx.t('canvas_add_task')}
  </button>
</div>
