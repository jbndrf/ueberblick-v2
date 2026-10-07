import { roleSubject } from './actor';
import type { PermSubject } from './contract';

/** An audience as written in the file: `$all` or a list of subject keys (a bare key is a role). */
export type AudienceInput = string | readonly string[] | undefined;

/** A compiled audience: who is in it. Absent means nobody (deny by default, F6). */
export type Audience =
  | { readonly kind: 'none' }
  | { readonly kind: 'all' }
  | { readonly kind: 'some'; readonly subjects: ReadonlySet<PermSubject> };

const NONE: Audience = { kind: 'none' };
const ALL: Audience = { kind: 'all' };

/** `kontrolle` is `role:kontrolle`; `team:nord` is already a subject. */
const asSubject = (entry: string): PermSubject => (entry.includes(':') ? entry : roleSubject(entry));

export function compileAudience(input: AudienceInput): Audience {
  if (input === undefined) return NONE;
  if (input === '$all') return ALL;
  if (typeof input === 'string') return NONE; // an unknown audience keyword denies
  if (input.length === 0) return NONE;
  return { kind: 'some', subjects: new Set(input.map(asSubject)) };
}

/** `$all` admits every actor, including one without subjects. */
export const admits = (a: Audience, subjects: readonly PermSubject[]): boolean =>
  a.kind === 'all' || (a.kind === 'some' && subjects.some((s) => a.subjects.has(s)));
