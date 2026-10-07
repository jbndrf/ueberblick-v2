/**
 * What compile knows about one `derive:` expression (F9): the problems it may have (`derive_no_prefilter`,
 * `derive_uses_time`). The shape itself lives in views.ts, which the participant shell loads.
 */
import type { TemplateFile } from '../file';
import type { CompiledExpr } from './contract';
import { kp } from './kp';
import type { Sink } from './problems';
import { deriveShape } from './views';

/** Problems for derive expressions fold cannot compute (`derive_no_prefilter`, `derive_uses_time`, `derive_traverses_relation`). */
export function checkDerive(
  file: TemplateFile,
  expressions: ReadonlyMap<string, CompiledExpr>,
  sink: Sink,
): void {
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    for (const [rk, rel] of Object.entries(type.relations ?? {})) {
      const path = kp('types', tk, 'relations', rk, 'derive');
      const ast = rel.derive === undefined ? undefined : expressions.get(path)?.typed.ast;
      if (!ast) continue;
      const shape = deriveShape(ast);
      if (shape.prefilter === undefined) {
        sink.error(
          path,
          'derive_no_prefilter',
          'a derived relation needs a spatial predicate as a top-level `&&` operand',
          'write e.g. `self.datum == other.datum && intersects(self.geometry, other.geometry)`; a predicate under `||`, `!` or `?:` cannot prefilter',
          {},
          ast.span,
        );
      }
      const declared = (t: string | undefined): ReadonlySet<string> =>
        new Set(Object.keys(file.types?.[t ?? '']?.relations ?? {}));
      const viaRelation =
        shape.dereferences ||
        [...shape.selfFields].some((f) => declared(tk).has(f)) ||
        [...shape.otherFields].some((f) => declared(rel.to).has(f));
      if (viaRelation) {
        sink.error(
          path,
          'derive_traverses_relation',
          'a derive condition reads only own properties of `self` and `other`, not related features',
          'remove the relation traversal (`self.<relation>...`, `other.<relation>...`): derived edges would go stale when the related feature changes',
          {},
          ast.span,
        );
      }
      if (shape.usesTime) {
        sink.error(
          path,
          'derive_uses_time',
          'a derived relation may not read `now` or `today()`',
          'derived edges must not change with time; compare against a property instead',
          {},
          ast.span,
        );
      }
    }
  }
}
