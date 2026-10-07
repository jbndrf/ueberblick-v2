/** v3's task pane on the Doc (WP-336): `TaskConfigSidebar` as the builder's task inspector. */
import type { BuilderRegistry } from '../shell/registry';
import TaskPane from './TaskPane.svelte';

/** Registers the task inspector (a selected task opens it in the right pane). */
export function registerTaskPane(registry: BuilderRegistry): void {
  registry.registerInspector('task', TaskPane, { width: 'task' });
}

export {
  conditionOps,
  createRoleOps,
  deleteOps,
  dependentRules,
  descriptionOps,
  entryOps,
  labelOps,
  rolesOps,
  stageOps,
} from './ops';
export { stageOf, withStage } from './when';
