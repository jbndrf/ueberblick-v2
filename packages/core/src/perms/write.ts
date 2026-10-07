/**
 * The write section of a type's permissions, compiled once (R1): `compilePerms` (the plan's `canWrite`) and the
 * compile check `task_role_cannot_write` both ask `writableProperties`, so they cannot disagree.
 */
import { admits, compileAudience, type Audience, type AudienceInput } from './audience';
import type { PermSubject } from './contract';

/** An audience for the whole type, or one per property. */
export interface Scoped {
  readonly whole?: Audience;
  readonly byProperty?: ReadonlyMap<string, Audience>;
}

export function scoped(input: AudienceInput | Readonly<Record<string, AudienceInput>>): Scoped {
  if (input === undefined || typeof input === 'string' || Array.isArray(input))
    return { whole: compileAudience(input as AudienceInput) };
  const m = new Map<string, Audience>();
  for (const [k, v] of Object.entries(input as Readonly<Record<string, AudienceInput>>))
    m.set(k, compileAudience(v));
  return { byProperty: m };
}

/** The properties these subjects may write: a whole-type audience covers all, a map only the listed ones. */
export function writableProperties(
  write: Scoped,
  allProps: readonly string[],
  subjects: readonly PermSubject[],
): ReadonlySet<string> {
  const { whole, byProperty } = write;
  if (whole !== undefined) return admits(whole, subjects) ? new Set(allProps) : new Set();
  const out = new Set<string>();
  for (const [k, a] of byProperty ?? []) if (allProps.includes(k) && admits(a, subjects)) out.add(k);
  return out;
}
