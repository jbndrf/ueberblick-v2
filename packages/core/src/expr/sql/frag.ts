/**
 * SQL fragments with their bound parameters. Values are never pasted into SQL text: a fragment carries
 * `?` placeholders and the values in order of appearance, so fragments concatenate and duplicate safely.
 */
import type { Span } from '../ast';

export type SqlParam = string | number;

export interface Frag {
  readonly sql: string;
  readonly params: readonly SqlParam[];
}

export const raw = (sql: string): Frag => ({ sql, params: [] });
export const bind = (v: SqlParam): Frag => ({ sql: '?', params: [v] });

/** Concatenates text and fragments; parameters keep their order. */
export function cat(...parts: readonly (string | Frag)[]): Frag {
  let sql = '';
  const params: SqlParam[] = [];
  for (const p of parts) {
    if (typeof p === 'string') sql += p;
    else {
      sql += p.sql;
      for (const x of p.params) params.push(x);
    }
  }
  return { sql, params };
}

/** Thrown while translating when a construct has no SQL encoding; `toSql` turns it into `unsupported`. */
export class SqlUnsupported extends Error {
  constructor(
    readonly reason: string,
    readonly span?: Span,
  ) {
    super(reason);
  }
}

export function unsupported(reason: string): never {
  throw new SqlUnsupported(reason);
}
