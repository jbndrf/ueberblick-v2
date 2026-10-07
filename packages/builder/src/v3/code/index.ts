/** v3's Code view on the Doc (WP-379): the Objektart as YAML in the middle, the element's YAML in the inspector. */
import type { Component } from 'svelte';
import type { BuilderRegistry, SelectionKind } from '../shell/registry';
import CodeView from './CodeView.svelte';
import YamlToggled from './YamlToggled.svelte';

/** Registers the `code` view of the toolbar switch. */
export function registerCodeView(registry: BuilderRegistry): void {
  registry.registerView('code', CodeView);
}

/** The selections whose inspector gets v3's "Formular | YAML" toggle (a task has its own YAML tab). */
export const YAML_TOGGLE_KINDS: readonly SelectionKind[] = ['type', 'rule', 'field'];

/**
 * Puts the toggle above the inspectors of `YAML_TOGGLE_KINDS`. The registry wraps at lookup time, so it
 * does not matter whether a pane registers before or after this call; a kind without a pane shows the YAML alone.
 */
export function registerEntityYaml(registry: BuilderRegistry): void {
  for (const kind of YAML_TOGGLE_KINDS) {
    registry.registerInspectorWrap(
      kind,
      (inner) =>
        // A component is a function of (anchor, props): this one is the toggle with its form bound.
        ((anchor: never, props: Record<string, unknown>) =>
          (YamlToggled as unknown as (a: never, p: Record<string, unknown>) => unknown)(anchor, {
            ...props,
            inner,
          })) as unknown as Component,
    );
  }
}

export { completeRefs, refSources } from './refs';
export type { RefSources } from './refs';
export { scopeOf } from './scope';
