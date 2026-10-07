/**
 * core.perms contract (docs/02 F6, decision 0012, docs/05 "Permissions").
 * CONTRACT — written by the lead; changes need the lead. Implemented by WP-042, consumed by plan
 * (WP-041), the server sync/API (WP-104/106/110) and the device (hides what the actor can't use).
 *
 * One permission section per feature type, compiled three ways, all from `compilePerms(config)`:
 * - an SQL predicate (sync, API, views) via `expr.toSql` + `propertySql` (R1: no second encoding),
 * - property allowlists (read and write),
 * - planner checks (`canSee`, `canCreate`, `canWrite`, `canDelete`).
 * Deny by default: an absent audience denies everyone. In a `see` map, unlisted properties stay
 * visible to every subject that sees the feature; in a `write` map, unlisted properties are denied.
 * Subjects are strings `<kind>:<key>` (registry PERM_SUBJECT_KINDS), so teams (O12) can join later.
 */
import type { CompiledConfig } from '../schema/compile/contract';
import type { EvalContext } from '../expr/contract';
import type { Json, Actor, FeatureState, Instant, Key } from '../model';
import type { ActorKind, PermDenial } from '../registry';

/** `<kind>:<key>`, e.g. `role:kontrolle`. */
export type PermSubject = string;

/** Who the probe is for `actor.id` / `actor.kind` in rules; the caller chooses it (e.g. a named probe participant). */
export interface ProbeIdentity {
  readonly id: string;
  readonly kind: ActorKind;
}

export type PermDecision =
  { readonly ok: true } | { readonly ok: false; readonly denial: PermDenial; readonly property?: string };

/** A parameterised SQL fragment over the `features` row alias given by the caller. */
export type PermSql =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'where'; readonly sql: string; readonly params: readonly Json[] };

export interface TypePerms {
  readonly type: Key;
  /** Row filter for this type (audience ∧ visible_when); `now` is bound as a parameter, so `now`/`today()` translate. A `visible_when` toSql cannot translate yields `none` (fail closed). */
  /** Must be index-friendly (no function on columns beyond `propertySql`). */
  seeSql(subjects: readonly PermSubject[], actor: Actor, alias: string, now: Instant): PermSql;
  /** Properties the subjects may read on a visible feature; the rest are stripped before sync/API. */
  readable(subjects: readonly PermSubject[]): ReadonlySet<string>;
  /** Properties the subjects may write. */
  writable(subjects: readonly PermSubject[]): ReadonlySet<string>;
  /** In-memory equivalent of `seeSql` (audience ∧ visible_when via evaluate); must agree with it. */
  canSee(subjects: readonly PermSubject[], feature: FeatureState, ctx: EvalContext): PermDecision;
  /**
   * Row-level `canSee` for a set of subjects with no actor at hand (builder roles lens, previews).
   * Same audience ∧ visible_when as `canSee`/`seeSql` (R1). The rule's `actor` is `{ ...identity, roles }` with
   * `roles` from `rolesOfSubjects(subjects)`; nothing is read from `ctx`'s `actor` and there is no default identity.
   * Denies with `subject_invalid` (a caller bug, not a config state) if any subject is malformed.
   * Agrees with `canSee` for the actor with that identity and those subjects.
   */
  canSeeRow(
    subjects: readonly PermSubject[],
    identity: ProbeIdentity,
    feature: FeatureState,
    ctx: EvalContext,
  ): PermDecision;
  canCreate(subjects: readonly PermSubject[]): PermDecision;
  canWrite(subjects: readonly PermSubject[], properties: Iterable<string>): PermDecision;
  canDelete(subjects: readonly PermSubject[], feature: FeatureState, ctx: EvalContext): PermDecision;
}

export interface Perms {
  /** Subjects of an actor (today `role:<r>` per role; the single place that maps actors to subjects). */
  subjects(actor: Actor): readonly PermSubject[];
  // The inverse is `rolesOfSubjects(subjects)` (undefined on a malformed subject) / `parseSubject(subject)` (perms/actor.ts).
  /** Undefined for an unknown type; callers treat that as `type_unknown`. */
  forType(type: Key): TypePerms | undefined;
}

export interface PermsApi {
  compilePerms(config: CompiledConfig): Perms;
}
