/** The stage pane (WP-335): v3's StageInspector with the participant preview. */
import type { BuilderRegistry } from '../shell/registry';
import StagePane from './StagePane.svelte';

/**
 * v3's registry maps both a stage and no selection to `StageInspector` (`inspector/registry.ts:21-23`):
 * a stage shows its buttons and data, nothing selected shows the "Standardansicht".
 */
export function registerStagePane(registry: BuilderRegistry): void {
  registry.registerInspector('stage', StagePane, { width: 'wide' });
  registry.registerInspector('none', StagePane, { width: 'wide' });
}

export { stageOps, stageDeleteImpact, stageTypeOf, newStageKey, STAGE_TYPES } from './ops';
export type { StageType } from './ops';
export { stagePreview, previewRoles, ALL_ROLES } from './preview';
