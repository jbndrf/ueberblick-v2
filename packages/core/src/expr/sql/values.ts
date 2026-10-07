/**
 * What a sub-expression translates to: a SQL fragment, a property path of a row, a whole row, a relation
 * set or a constant. Rows reached through a to-one relation are read with scalar subqueries over `edges`.
 */
import type { Json } from '../../model';
import type { Ty } from '../check/types';
import { propertySql } from './contract';
import { bind, cat, raw, unsupported, type Frag } from './frag';
import { liveEdgeJoin } from './liveEdge';

/** A feature row: the query's own (`self`, `other`, a comprehension variable) or one reached through a relation. */
export type Row =
  | { readonly kind: 'root'; readonly alias: string }
  | {
      readonly kind: 'rel';
      readonly alias: string;
      readonly parent: Row;
      readonly relation: string;
      readonly inverse: boolean;
    };

export type Val =
  | { readonly k: 'sql'; readonly f: Frag; readonly ty: Ty }
  | { readonly k: 'prop'; readonly base: Row; readonly path: readonly (string | number)[]; readonly ty: Ty }
  | { readonly k: 'row'; readonly row: Row }
  | { readonly k: 'rows'; readonly parent: Row; readonly relation: string; readonly inverse: boolean }
  | { readonly k: 'const'; readonly v: Json; readonly ty: Ty };

/** Keys that are safe to put into a JSON path; anything else has no SQL encoding. */
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function safeKey(key: string): string {
  if (!SAFE_KEY.test(key)) return unsupported(`property name '${key}' is not a plain key`);
  return key;
}

function jsonPath(path: readonly (string | number)[]): string {
  return `$${path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${safeKey(p)}`)).join('')}`;
}

/** Wraps `inner` (which reads from `row`) in the scalar subqueries that reach `row` from a root row. */
function through(row: Row, inner: Frag, fresh: () => string): Frag {
  if (row.kind === 'root') return inner;
  const e = fresh();
  const j = liveEdgeJoin({ edge: e, feature: row.alias, direction: row.inverse ? 'in' : 'out' });
  const sub = cat(
    '(SELECT ',
    inner,
    ` FROM edges ${e} ${j.join}`,
    ` WHERE ${e}.${j.near} = ${row.parent.alias}.id AND ${e}.relation = `,
    bind(row.relation),
    ` AND ${j.live} LIMIT 1)`,
  );
  return through(row.parent, sub, fresh);
}

/** The value at `path` of a row's properties. A single key is exactly `propertySql`, so indexes are hit. */
export function propFrag(base: Row, path: readonly (string | number)[], fresh: () => string): Frag {
  const [first, ...rest] = path;
  if (typeof first !== 'string') return unsupported('a property path must start with a name');
  const inner =
    rest.length === 0
      ? raw(propertySql(base.alias, safeKey(first)))
      : raw(`json_extract(${base.alias}.properties, '${jsonPath(path)}')`);
  return through(base, inner, fresh);
}

/** A system field (`self.$created_by`): the `features` column itself, reached from a root row through the relations. */
export function columnFrag(base: Row, column: string, fresh: () => string): Frag {
  return through(base, raw(`${base.alias}.${column}`), fresh);
}

/** A stored value read as a bool: true only for JSON `true`, false only for JSON `false`, otherwise null. */
export function boolPropFrag(base: Row, path: readonly (string | number)[], fresh: () => string): Frag {
  const inner = raw(
    `(CASE json_type(${base.alias}.properties, '${jsonPath(path)}') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END)`,
  );
  return through(base, inner, fresh);
}

/** The relation set of a row as a `FROM` clause over `edges` and `features`, ending in `WHERE <base>`. */
export function relationFrom(
  parent: Row,
  relation: string,
  inverse: boolean,
  alias: string,
  e: string,
): Frag {
  const j = liveEdgeJoin({ edge: e, feature: alias, direction: inverse ? 'in' : 'out' });
  return cat(
    `FROM edges ${e} ${j.join} WHERE ${e}.${j.near} = ${parent.alias}.id`,
    ` AND ${e}.relation = `,
    bind(relation),
    ` AND ${j.live}`,
  );
}

/** Reaches a query built on `parent` (a scalar subquery over a relation set) from the root row. */
export function fromRoot(parent: Row, query: Frag, fresh: () => string): Frag {
  return through(parent, query, fresh);
}

export function constFrag(v: Json, ty: Ty): Frag {
  if (v === null) return raw('NULL');
  if (typeof v === 'boolean') return raw(v ? '1' : '0');
  if (typeof v === 'number' || typeof v === 'string') return bind(v);
  return unsupported(`a ${Array.isArray(v) ? 'list' : 'map'} value (${ty.kind})`);
}

export function sqlOf(v: Val, fresh: () => string): Frag {
  switch (v.k) {
    case 'sql':
      return v.f;
    case 'prop':
      return propFrag(v.base, v.path, fresh);
    case 'const':
      return constFrag(v.v, v.ty);
    case 'row':
      return unsupported('a feature used as a value');
    case 'rows':
      return unsupported('a relation set used as a value');
  }
}
