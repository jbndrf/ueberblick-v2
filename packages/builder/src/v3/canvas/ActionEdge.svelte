<script lang="ts">
  // v3 `task-canvas/ActionEdge.svelte`: a line from a task's exit dot to the stage it moves the feature to
  // (no toolbar on it: the outcome belongs to the task). A task's arrow is selectable and deletable (Delete),
  // and while selected its end can be dragged to another phase (WP-435). Parallel and opposing
  // arrows fan out by `curveOffset`; a self loop bulges to the right. v4 adds two looks the engine
  // needs: a rule's arrow is dashed, an `otherwise` step's arrow dotted (not by colour alone).
  import { BaseEdge, EdgeReconnectAnchor, getBezierPath, type EdgeProps } from '@xyflow/svelte';
  import { CANVAS_ORIGINS, type CanvasOrigin } from './model';

  interface EdgeData extends Record<string, unknown> {
    curveOffset: number;
    origin: CanvasOrigin;
    otherwise: boolean;
  }

  let {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data: raw,
    markerEnd,
    selected,
  }: EdgeProps = $props();

  const data = $derived(raw as EdgeData | undefined);
  const offset = $derived(data?.curveOffset ?? 0);
  const selfLoop = $derived(Math.abs(sourceX - targetX) < 1 && Math.abs(sourceY - targetY) < 1);

  /** A quadratic curve bulging perpendicular to the travel direction by `offset` px. */
  function offsetPath(sx: number, sy: number, tx: number, ty: number, by: number): string {
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const cx = (sx + tx) / 2 + (dy / len) * by;
    const cy = (sy + ty) / 2 + (-dx / len) * by;
    return `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`;
  }

  const path = $derived.by(() => {
    if (selfLoop)
      return `M ${sourceX},${sourceY} C ${sourceX + 70},${sourceY - 70} ${sourceX + 70},${sourceY + 70} ${sourceX},${sourceY}`;
    if (offset !== 0) return offsetPath(sourceX, sourceY, targetX, targetY, offset);
    return getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];
  });
  const look = $derived(
    data?.origin === CANVAS_ORIGINS.entry
      ? 'entry-edge'
      : data?.origin === CANVAS_ORIGINS.rule
        ? 'rule-edge'
        : data?.otherwise
          ? 'otherwise-edge'
          : '',
  );
</script>

<BaseEdge {path} {...markerEnd !== undefined ? { markerEnd } : {}} class={look} />
{#if selected && data?.origin === CANVAS_ORIGINS.task}
  <!-- v3 had no way to move the end of an arrow; the engine's buttons can have several, so the selected arrow's end is a handle (WP-435). -->
  <EdgeReconnectAnchor type="target" position={{ x: targetX, y: targetY }} />
{/if}
