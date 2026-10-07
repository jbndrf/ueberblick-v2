/** v3's task canvas on the Doc (WP-334): the middle "Workflow" view of the builder frame. */
import type { BuilderRegistry } from '../shell/registry';
import TaskCanvas from './TaskCanvas.svelte';

export { buildCanvas, nodeId, STAGE_KINDS, CANVAS_ORIGINS, TOOL_KINDS } from './model';
export type { CanvasModel, CanvasArrow, StageCard, TaskButton } from './model';
export { subprocessLinks, childLinks, parentLinks } from './subprocess';
export type { SubprocessLink } from './subprocess';
export { renameTaskOp } from './rename';

/** Registers the canvas as the Workflow view. */
export function registerCanvas(registry: BuilderRegistry): void {
  registry.registerView('workflow', TaskCanvas);
}
export { setCanvasLayoutApi } from './layout-api';
export type { CanvasLayoutApi, PlacedNode } from './layout-api';
