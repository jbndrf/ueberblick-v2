/** v3's Modell view with its "Berechtigungen" matrix (WP-331). */
import type { BuilderRegistry } from '../../shell/registry';
import ModelView from './ModelView.svelte';

/** Registers the Modell view of the toolbar switch (S4-16 adds the Felder and Aufgaben tabs to it). */
export function registerModelView(registry: BuilderRegistry): void {
  registry.registerView('model', ModelView);
}
