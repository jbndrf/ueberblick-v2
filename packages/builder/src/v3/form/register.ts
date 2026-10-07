/** Registers v3's form editor as the inspector of a selected task's form (selection kind `form`, id = the task key). */
import type { BuilderRegistry } from '../shell/registry';
import FormEditor from './FormEditor.svelte';

export function registerFormEditor(registry: BuilderRegistry): void {
  registry.registerInspector('form', FormEditor, { width: 'form' });
}
