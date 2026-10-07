/**
 * Rule language → SQLite (docs/06 "Parity"), explain and builder chips.
 * CONTRACT — written by the lead; changes need the lead. Implemented by WP-022.
 * `toSql` is the only second encoding of the language; the parity corpus proves it equals `evaluate`.
 */
import type { Geo } from '../../geo/contract';
import type { Json } from '../../model';
import type { ExprBinaryOperator } from '../../registry';
import type { Expr, Span } from '../ast';
import type { TypedAst } from '../check/check';
import type { EvalContext } from '../contract';

/**
 * The single definition of how a feature property is read in SQL (R1). Expression indexes
 * (server deploy) and `toSql` both use it, so generated filters hit the indexes. An empty alias gives the
 * unqualified column, the only form SQLite accepts inside `CREATE INDEX`.
 */
export const propertySql = (featureAlias: string, key: string): string =>
  `json_extract(${featureAlias === '' ? '' : `${featureAlias}.`}properties, '$.${key}')`;

export interface SqlMapping {
  /** Alias of the `features` row that `self` (or `other`) refers to in the surrounding query. */
  readonly self: string;
  readonly other?: string;
  /**
   * Inverse relations (`inverse_of`), as `<type>.<field>` to the relation key their edges are stored under
   * (`edges.relation`, with `edges.to_id` the current feature): read backwards. The compiled config supplies
   * it (`sqlInverse(config)`, schema/compile/views.ts); nothing else produces it.
   */
  readonly inverse?: ReadonlyMap<string, string>;
  /** Values for non-row variables (`actor`, `inputs`, `now`, `form`): bound as parameters, never inlined. */
  readonly vars: ReadonlyMap<string, Json>;
  /**
   * The geometry port, used only to fold constant spatial parts (`area({...})`). Without it such a part is
   * unsupported. Spatial predicates on stored geometries are never translated.
   */
  readonly geo?: Geo;
}

export type SqlResult =
  | { readonly ok: true; readonly sql: string; readonly params: readonly Json[] }
  | { readonly ok: false; readonly unsupported: { readonly span: Span; readonly reason: string } };

/** One sub-expression's contribution to a condition's outcome. */
export interface ExplainPart {
  readonly span: Span;
  readonly source: string;
  readonly value: Json;
  /** Set when the sub-expression could not be evaluated (its `value` is then null). */
  readonly error?: string;
  /** The values behind a comparison, e.g. `self.stage is 'erledigt'`. */
  readonly detail?: string;
  /** True when the sub-expression reads only the actor (roles, kind, id) and nothing else of the world (the failure is about the person). */
  readonly actorOnly: boolean;
}

export interface Explanation {
  readonly value: boolean;
  /** The minimal sub-expressions that decided the outcome (e.g. the false conjunct). */
  readonly decisive: readonly ExplainPart[];
  /** True when more decisive parts exist than `decisive` lists. */
  readonly more: boolean;
  /** A readable sentence, e.g. "not available because self.stage == 'erledigt'". */
  readonly text: string;
}

/** Builder chips: a flat, editable view of simple conditions; anything else stays text. */
export type Chip =
  | { readonly kind: 'compare'; readonly left: string; readonly op: ExprBinaryOperator; readonly right: Json }
  | { readonly kind: 'join'; readonly op: ExprBinaryOperator };

export type ChipsResult =
  { readonly ok: true; readonly chips: readonly Chip[] } | { readonly ok: false; readonly text: string };

export interface SqlApi {
  toSql(typed: TypedAst, mapping: SqlMapping): SqlResult;
  explain(typed: TypedAst, ctx: EvalContext): Explanation;
  toChips(ast: Expr): ChipsResult;
  fromChips(chips: readonly Chip[]): Expr;
}
