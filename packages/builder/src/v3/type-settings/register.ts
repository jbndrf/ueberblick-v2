/** Registers v3's Workflow-Einstellungen as the inspector of the selection kind `type` (the toolbar's gear). */
import type { BuilderRegistry } from '../shell/registry';
import TypeSettingsPane from './TypeSettingsPane.svelte';

export function registerTypeSettingsPane(registry: BuilderRegistry): void {
  registry.registerInspector('type', TypeSettingsPane, { width: 'settings' });
}
