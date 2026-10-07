/**
 * `permissions.visible_when` runs as SQL on the server (docs/decisions/0012). A filter `toSql` cannot
 * translate makes the server hide every row of the type (fail closed), so compile warns. The mapping is
 * `visibleWhenMapping`, the one definition perms also uses (R1); nothing here translates by itself.
 */
import type { Actor } from '../../model';
import { toSql, type SqlMapping } from '../../expr/sql';
import type { CompiledExpr } from './contract';
import type { TemplateFile } from '../file';
import { kp } from './kp';
import type { Sink } from './problems';
import { sqlInverse } from './views';

/** Alias of the `features` row in the row filter query. */
export const VISIBLE_WHEN_ALIAS = 'f';

/** The mapping under which `visible_when` is translated; `actor` is bound as a parameter, never inlined. */
export function visibleWhenMapping(config: { readonly file: TemplateFile }, actor: Actor): SqlMapping {
  return {
    self: VISIBLE_WHEN_ALIAS,
    inverse: sqlInverse(config),
    vars: new Map([['actor', { id: actor.id, kind: actor.kind, roles: [...actor.roles] }]]),
  };
}

const PLACEHOLDER_ACTOR: Actor = { id: '', kind: 'participant', roles: [] };

export function checkVisibleWhen(
  file: TemplateFile,
  expressions: ReadonlyMap<string, CompiledExpr>,
  sink: Sink,
): void {
  for (const tk of Object.keys(file.types ?? {})) {
    const path = kp('types', tk, 'permissions', 'visible_when');
    const expr = expressions.get(path);
    if (expr === undefined) continue;
    const r = toSql(expr.typed, visibleWhenMapping({ file }, PLACEHOLDER_ACTOR));
    if (r.ok) continue;
    sink.warn(
      path,
      'visible_when_not_sql',
      `${r.unsupported.reason} (at offset ${r.unsupported.span.start}); the server hides every ${tk} row`,
      'rewrite the filter with comparisons on properties, relations and `actor` (no spatial predicates on stored geometries); until then no row of this type is visible',
      { type: tk, reason: r.unsupported.reason, position: r.unsupported.span.start },
      r.unsupported.span,
    );
  }
}
