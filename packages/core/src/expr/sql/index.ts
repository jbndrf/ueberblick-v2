/**
 * `toSql(typed, mapping)`: the SQLite encoding of the rule language (docs/06 "Parity"). Total: it never
 * throws; a construct without an encoding gives `{ ok: false, unsupported }` and the caller evaluates the
 * expression in core instead (the result must then be the same, which the parity corpus proves for every
 * construct that does have SQL). Every value is a bound parameter, so an assistant-written or CQL2 filter
 * cannot inject SQL (H4).
 */
import type { TypedAst } from '../check/check';
import { fromChips, toChips } from '../chips';
import { explain } from '../explain';
import type { SqlApi, SqlMapping, SqlResult } from './contract';
import { SqlUnsupported } from './frag';
import { Translator } from './translate';

export { SQL_APP_FUNCTIONS } from './appFunctions';
export type { SqlAppFunction } from './appFunctions';
export { propertySql } from './contract';
export type { Chip, ChipsResult, ExplainPart, Explanation, SqlApi, SqlMapping, SqlResult } from './contract';

export function toSql(typed: TypedAst, mapping: SqlMapping): SqlResult {
  try {
    const f = new Translator(typed, mapping).translate(typed.ast);
    return { ok: true, sql: f.sql, params: f.params };
  } catch (e) {
    if (e instanceof SqlUnsupported)
      return { ok: false, unsupported: { span: e.span ?? typed.ast.span, reason: e.reason } };
    if (e instanceof RangeError)
      return { ok: false, unsupported: { span: typed.ast.span, reason: 'expression is nested too deeply' } };
    throw e;
  }
}

export const sqlApi: SqlApi = { toSql, explain, toChips, fromChips };
