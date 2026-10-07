// `display.condition` of the properties of one type, evaluated for the open feature (v3 `evaluateShowIf` over the
// current values, state.svelte.ts 599). The one rule language (R5): the compiled expressions are looked up by key path,
// an error or a missing value counts as false (docs/06 "Evaluation is total"). One evaluation per conditional property.
import { condition } from '@ueberblick/core/expr';
import type { EvalContext } from '@ueberblick/core/expr';
import type { Key } from '@ueberblick/core/model';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { formatKeyPath } from '@ueberblick/core/template';

/** The properties (of `keys`) whose condition is false for the feature `ctx` has as `self`. */
export function conditionFalse(
  config: CompiledConfig,
  type: Key,
  keys: readonly Key[],
  ctx: EvalContext,
): ReadonlySet<Key> {
  const out = new Set<Key>();
  for (const key of keys) {
    const compiled = config.expressions.get(
      formatKeyPath(['types', type, 'properties', key, 'display', 'condition']),
    );
    if (compiled !== undefined && !condition(compiled.typed, ctx).value) out.add(key);
  }
  return out;
}
