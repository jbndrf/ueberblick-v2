// The rule pane (WP-377): v3's AutomationConfig on the Doc. (glossary-lint-ignore: v3 file name)
import type { BuilderRegistry } from '../shell/registry';
import RulePane from './RulePane.svelte';

/** Registers the rule inspector (a selected rule opens it in the right pane). */
export function registerRulePane(registry: BuilderRegistry): void {
  registry.registerInspector('rule', RulePane);
}

export { createRuleOps, defaultTrigger } from './ops';
export type { CreatedRule, NewRuleNames } from './ops';
export { ownsTask } from './auto-task';
