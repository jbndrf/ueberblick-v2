/** Registers v3's Felddefinition as the inspector of a selected property (selection kind `field`). */
import type { BuilderRegistry } from '../shell/registry';
import FieldPane from './FieldPane.svelte';

export function registerFieldPane(registry: BuilderRegistry): void {
  registry.registerInspector('field', FieldPane, { width: 'field' });
}
