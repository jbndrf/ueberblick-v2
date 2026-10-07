import type { Actor, Json } from '../model';
import { PERM_SUBJECT_KINDS, type PermSubjectKind } from '../registry';
import type { PermSubject } from './contract';

/** The subject of a role (`role:<key>`, registry PERM_SUBJECT_KINDS). The only place that spells it. */
export const roleSubject = (role: string): PermSubject => `role:${role}`;

/** The subjects of an actor. Today one per role; teams (O12) add their own kind here and nowhere else. */
export const subjectsOf = (actor: Actor): readonly PermSubject[] => actor.roles.map(roleSubject);

/**
 * The `actor` variable as rules see it: the value that both `evaluate` (planner, device) and `toSql`
 * (server) must bind, so `visible_when` means the same on every side (R1).
 */
export const actorValue = (actor: Actor): { readonly [k: string]: Json } => ({
  id: actor.id,
  kind: actor.kind,
  roles: actor.roles as readonly Json[],
});

/** Splits `<kind>:<key>`; undefined when the kind is not in PERM_SUBJECT_KINDS or the key is empty. */
export function parseSubject(
  subject: PermSubject,
): { readonly kind: PermSubjectKind; readonly key: string } | undefined {
  const i = subject.indexOf(':');
  if (i <= 0 || i === subject.length - 1) return undefined;
  const kind = subject.slice(0, i);
  const known = PERM_SUBJECT_KINDS.keys as readonly string[];
  return known.includes(kind) ? { kind: kind as PermSubjectKind, key: subject.slice(i + 1) } : undefined;
}

/** What each subject kind contributes to the `actor` a rule sees. Total over PERM_SUBJECT_KINDS: a new kind fails to compile until it says. */
const CONTRIBUTES: Readonly<Record<PermSubjectKind, (key: string) => { readonly role?: string }>> = {
  role: (key) => ({ role: key }),
};

/**
 * The inverse of `subjectsOf`: the roles carried by subjects (other kinds add none), order kept, duplicates dropped.
 * Undefined when any subject is malformed (unknown kind, no key): never silently dropped.
 */
export function rolesOfSubjects(subjects: readonly PermSubject[]): readonly string[] | undefined {
  const out: string[] = [];
  for (const s of subjects) {
    const p = parseSubject(s);
    if (p === undefined) return undefined;
    const role = CONTRIBUTES[p.kind](p.key).role;
    if (role !== undefined && !out.includes(role)) out.push(role);
  }
  return out;
}
