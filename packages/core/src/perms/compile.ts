/**
 * compilePerms: one permission section per feature type, compiled three ways (docs/02 F6, decision 0012).
 * Semantics (docs/05 "Permissions"): an absent audience denies; a `see` map leaves the row visible to every
 * actor and restricts only the listed properties; a `write` map denies unlisted properties.
 */
import { condition } from '../expr/evaluate';
import type { EvalContext } from '../expr/contract';
import { toSql } from '../expr/sql';
import type { TypedAst } from '../expr/check/check';
import type { Actor, FeatureState, Instant, Json, Key } from '../model';
import type { CompiledConfig } from '../schema/compile/contract';
import { visibleWhenMapping } from '../schema/compile/visible';
import { kp } from '../schema/compile/kp';
import type { FeatureType } from '../schema/feature-type';
import { actorValue, rolesOfSubjects, subjectsOf } from './actor';
import { admits, compileAudience, type Audience } from './audience';
import { scoped, writableProperties, type Scoped } from './write';
import type { PermDecision, PermSql, PermSubject, Perms, ProbeIdentity, TypePerms } from './contract';

/** `visible_when` is declared but not among the compiled expressions: refusing beats revealing rows. */
export class PermsCompileError extends Error {
  constructor(readonly type: Key) {
    super(`types.${type}.permissions.visible_when is declared but has no compiled expression`);
    this.name = 'PermsCompileError';
  }
}

const OK: PermDecision = { ok: true };
const deny = (denial: Extract<PermDecision, { ok: false }>['denial'], property?: string): PermDecision =>
  property === undefined ? { ok: false, denial } : { ok: false, denial, property };

class CompiledTypePerms implements TypePerms {
  private readonly see: Scoped;
  private readonly write: Scoped;
  private readonly create: Audience;
  private readonly del: Audience;
  private readonly allProps: readonly string[];
  private readonly visibleWhen: TypedAst | undefined;

  constructor(
    readonly type: Key,
    def: FeatureType,
    private readonly config: CompiledConfig,
  ) {
    const p = def.permissions;
    this.see = scoped(p?.see);
    this.write = scoped(p?.write);
    this.create = compileAudience(p?.create);
    this.del = compileAudience(p?.delete);
    this.allProps = Object.keys(def.properties);
    const compiled =
      p?.visible_when === undefined
        ? undefined
        : config.expressions.get(kp('types', type, 'permissions', 'visible_when'))?.typed;
    // Never drop a declared restriction: a missing expression means the config was not compiled with it.
    if (p?.visible_when !== undefined && compiled === undefined) throw new PermsCompileError(type);
    this.visibleWhen = compiled;
  }

  /** Does the audience part of `see` let these subjects see the row? */
  private rowAllowed(subjects: readonly PermSubject[]): boolean {
    if (this.see.byProperty !== undefined) return true; // a see map only strips properties
    return this.see.whole !== undefined && admits(this.see.whole, subjects);
  }

  seeSql(subjects: readonly PermSubject[], actor: Actor, alias: string, now: Instant): PermSql {
    if (!this.rowAllowed(subjects)) return { kind: 'none' };
    if (this.visibleWhen === undefined) return { kind: 'all' };
    // The one mapping (R1, `actor` included); only the row alias and `now` are per query.
    const base = visibleWhenMapping(this.config, actor);
    const r = toSql(this.visibleWhen, {
      ...base,
      self: alias,
      vars: new Map<string, Json>([...base.vars, ['now', now]]),
    });
    // Only an untranslatable expression lands here (compile should warn about it): fail closed rather than reveal rows the in-memory check might hide.
    return r.ok ? { kind: 'where', sql: r.sql, params: r.params } : { kind: 'none' };
  }

  readable(subjects: readonly PermSubject[]): ReadonlySet<string> {
    if (!this.rowAllowed(subjects)) return new Set();
    const by = this.see.byProperty;
    if (by === undefined) return new Set(this.allProps);
    return new Set(
      this.allProps.filter((k) => {
        const a = by.get(k);
        return a === undefined || admits(a, subjects);
      }),
    );
  }

  writable(subjects: readonly PermSubject[]): ReadonlySet<string> {
    return writableProperties(this.write, this.allProps, subjects);
  }

  canSee(subjects: readonly PermSubject[], feature: FeatureState, ctx: EvalContext): PermDecision {
    if (!this.rowAllowed(subjects)) return deny('not_visible');
    if (this.visibleWhen === undefined) return OK;
    const vars = new Map(ctx.vars);
    vars.set('self', { $feature: feature.id });
    return condition(this.visibleWhen, { ...ctx, vars }).value ? OK : deny('not_visible');
  }

  canSeeRow(
    subjects: readonly PermSubject[],
    identity: ProbeIdentity,
    feature: FeatureState,
    ctx: EvalContext,
  ): PermDecision {
    const roles = rolesOfSubjects(subjects);
    if (roles === undefined) return deny('subject_invalid');
    const vars = new Map(ctx.vars);
    vars.set('actor', actorValue({ id: identity.id, kind: identity.kind, roles: roles as readonly Key[] }));
    return this.canSee(subjects, feature, { ...ctx, vars });
  }

  canCreate(subjects: readonly PermSubject[]): PermDecision {
    return admits(this.create, subjects) ? OK : deny('create_denied');
  }

  canWrite(subjects: readonly PermSubject[], properties: Iterable<string>): PermDecision {
    const allowed = this.writable(subjects);
    for (const p of properties) if (!allowed.has(p)) return deny('write_denied', p);
    return OK;
  }

  canDelete(subjects: readonly PermSubject[], feature: FeatureState, ctx: EvalContext): PermDecision {
    if (!admits(this.del, subjects)) return deny('delete_denied');
    return this.canSee(subjects, feature, ctx);
  }
}

export function compilePerms(config: CompiledConfig): Perms {
  const types = new Map<Key, TypePerms>();
  for (const [key, def] of Object.entries(config.file.types ?? {}))
    types.set(key as Key, new CompiledTypePerms(key as Key, def, config));
  return { subjects: subjectsOf, forType: (t) => types.get(t) };
}
