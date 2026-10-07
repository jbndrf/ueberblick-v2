/**
 * Parses and type-checks every expression of the file once (docs/06). The checked expressions are
 * kept by key path in `CompiledConfig.expressions`; runtime code never parses strings.
 */
import { T, assignable, show, check, type Ty } from '../../expr/check';
import { parse } from '../../expr/parse';
import type { TemplateFile } from '../file';
import type { Property } from '../property';
import type { Task, ThenStep } from '../task';
import type { CompiledExpr } from './contract';
import { buildEnv, propertyTy, withVars, type CompileEnv } from './env';
import { checkBindField } from './bind-field';
import { refuseChoiceFilter } from './choice-filter';
import { kp } from './kp';
import { autoPath, listAutos } from './autos';
import { checkSchedule, isSweep } from './schedule';
import { checkWhenTrigger } from './when-trigger';
import { reportParseErrors, reportTypeErrors } from './expr-problems';
import type { Sink } from './problems';

/** Target of a `then.set` key: the property definition and its expression type, when resolvable. */
interface Target {
  readonly def: Property | undefined;
  readonly ty: Ty | undefined;
}

/** Names every expression can read besides `vars`. */
const BASE_NAMES: readonly string[] = ['actor', 'inputs', 'now'];

export class ExprPass {
  readonly expressions = new Map<string, CompiledExpr>();
  private readonly cenv: CompileEnv;
  private readonly parsed = new Map<string, ReturnType<typeof parse>>();
  /** Where each task's unprefixed form and `set` keys resolve (the created feature or `self`). */
  private readonly subjects = new Map<string, Ty | undefined>();

  constructor(
    private readonly file: TemplateFile,
    private readonly sink: Sink,
  ) {
    this.cenv = buildEnv(file);
  }

  run(): void {
    this.derived();
    for (const [key, task] of Object.entries(this.file.tasks ?? {})) this.task(key, task);
    this.autos();
    this.views();
  }

  /** Parse (cached by source), check, record. Returns the type, or undefined on a problem. */
  private expr(
    path: string,
    source: string,
    vars: Readonly<Record<string, Ty>>,
    opts: { expect?: Ty; device?: boolean; sql?: boolean } = {},
  ): Ty | undefined {
    let p = this.parsed.get(source);
    if (!p) {
      p = parse(source);
      this.parsed.set(source, p);
    }
    if (!p.ok) {
      reportParseErrors(this.sink, path, source, p.errors);
      return undefined;
    }
    const env = withVars(this.cenv, vars, opts.device ?? true, opts.sql ?? false);
    const r = check(p.ast, env, opts.expect ? { expect: opts.expect } : {});
    if (!r.ok) {
      reportTypeErrors(this.sink, path, source, r.errors, `change \`${source}\` so that it type-checks`);
      return undefined;
    }
    this.expressions.set(path, { path, source, typed: r.typed });
    return r.typed.type;
  }

  private derived(): void {
    for (const [tk, type] of Object.entries(this.file.types ?? {})) {
      const visible = type.permissions?.visible_when;
      if (visible !== undefined) {
        // The row filter runs as SQL on the server (F6), so it may use server-only functions.
        this.expr(
          kp('types', tk, 'permissions', 'visible_when'),
          visible,
          { self: this.cenv.feature(tk) },
          { expect: T.bool, device: false, sql: true },
        );
      }
      // The Daten condition runs on the device over the open feature: `self` and `actor`, a bool (WP-659).
      for (const [pk, prop] of Object.entries(type.properties)) {
        const cond = prop.display?.condition;
        if (cond === undefined) continue;
        this.expr(
          kp('types', tk, 'properties', pk, 'display', 'condition'),
          cond,
          { self: this.cenv.feature(tk) },
          { expect: T.bool },
        );
      }
      for (const [rk, rel] of Object.entries(type.relations ?? {})) {
        if (rel.derive === undefined) continue;
        this.expr(
          kp('types', tk, 'relations', rk, 'derive'),
          rel.derive,
          { self: this.cenv.feature(tk), other: this.cenv.feature(rel.to) },
          { expect: T.bool, device: false, sql: true },
        );
      }
    }
  }

  private task(key: string, task: Task): void {
    const at = (...rest: (string | number)[]): string => kp('tasks', key, ...rest);
    const self = this.cenv.taskSelf.get(key);
    const selfVars: Record<string, Ty> = self ? { self } : {};
    const vars: Record<string, Ty> = { ...selfVars };
    for (const [name, source] of Object.entries(task.bind ?? {})) {
      const ty = this.expr(at('bind', name), source, selfVars);
      if (ty === undefined) vars[name] = T.dyn;
      else if (ty.kind === 'feature' || ty.kind === 'dyn') vars[name] = ty;
      else {
        this.sink.error(
          at('bind', name),
          'expression_type',
          `bind '${name}' must be a related feature but is ${show(ty)}`,
          'bind a declared relation to one feature, e.g. `self.flaeche` (a relation with cardinality one)',
          { variant: 'bind', name, type: show(ty) },
        );
        vars[name] = T.dyn;
      }
    }
    if (task.when !== undefined) this.expr(at('when'), task.when, vars, { expect: T.bool });

    // With `creates`, form fields and unprefixed `set` keys address the created feature; otherwise `self`.
    const subject = task.creates !== undefined ? this.cenv.feature(task.creates) : self;
    this.subjects.set(key, subject);
    const form: Record<string, Ty> = {};
    for (const fk of Object.keys(task.form ?? {})) {
      form[fk] = this.target(vars, fk, subject).ty ?? T.dyn;
      if (fk.includes('.') && this.exists(at('form', fk), vars, fk, subject))
        checkBindField(this.sink, this.file, key, at('form', fk), vars[fk.split('.')[0] ?? ''], fk);
    }
    const formVars = { ...vars, form: { kind: 'record', fields: form } satisfies Ty };
    for (const [fk, field] of Object.entries(task.form ?? {})) {
      const ty = form[fk] ?? T.dyn;
      const def = this.target(vars, fk, subject).def;
      const flag = (name: 'required' | 'readonly'): void => {
        const v = field[name];
        if (typeof v === 'string') this.expr(at('form', fk, name), v, formVars, { expect: T.bool });
      };
      if (field.relevant !== undefined)
        this.expr(at('form', fk, 'relevant'), field.relevant, formVars, { expect: T.bool });
      flag('required');
      flag('readonly');
      if (field.constraint !== undefined) {
        this.expr(
          at('form', fk, 'constraint'),
          field.constraint,
          { ...formVars, value: ty },
          { expect: T.bool },
        );
      }
      // ODK `choice_filter` (WP-392): a bool over `option` (the option key), `form` and `self`, on a choice property.
      const cf = at('form', fk, 'choice_filter');
      const bad = field.choice_filter !== undefined && refuseChoiceFilter(this.sink, cf, fk, def?.type);
      if (field.choice_filter !== undefined && !bad)
        this.expr(cf, field.choice_filter, { ...formVars, option: T.string }, { expect: T.bool });
      if (field.calculate !== undefined) {
        const expect = ty.kind === 'dyn' ? undefined : ty;
        this.expr(at('form', fk, 'calculate'), field.calculate, formVars, expect ? { expect } : {});
      }
    }
    (task.then ?? []).forEach((step, i) => {
      if (step.when !== undefined) this.expr(at('then', i, 'when'), step.when, formVars, { expect: T.bool });
      if (step.redact !== undefined) this.redact(at('then', i, 'redact'), step.redact, formVars);
      const owner = step.of !== undefined ? this.thenOf(at('then', i, 'of'), step.of, formVars) : subject;
      for (const [target, value] of Object.entries(step.set ?? {})) {
        const path = at('then', i, 'set', target);
        if (step.of !== undefined && target.includes('.'))
          this.sink.error(
            path,
            'expression_type',
            `'${target}' is a bound-feature key, but the step has \`of\``,
            'with `of`, a key is a property of the features `of` names',
            { variant: 'bound_key', target },
          );
        else this.setValue(path, target, value, formVars, owner);
      }
    });
  }

  /** `of` (A-035): a feature or a list of them; unprefixed `set` keys then address its type, returned when known. */
  private thenOf(path: string, source: string, vars: Readonly<Record<string, Ty>>): Ty | undefined {
    const ty = this.expr(path, source, vars);
    if (ty === undefined || ty.kind === 'dyn') return undefined;
    const target = ty.kind === 'list' ? ty.element : ty;
    if (target.kind !== 'feature' && target.kind !== 'dyn') {
      this.sink.error(
        path,
        'expression_type',
        `\`of\` must be a feature or a list of features but is ${show(ty)}`,
        'name a relation, e.g. `self.kinder`, or `self`',
        { variant: 'of', type: show(ty) },
      );
    }
    return target.kind === 'feature' ? target : undefined;
  }

  /** A `redact` step: `of` type-checks; `property:<key>` must be the subject of some personal property. */
  private redact(
    path: string,
    step: NonNullable<ThenStep['redact']>,
    vars: Readonly<Record<string, Ty>>,
  ): void {
    if (step.of !== undefined) this.expr(`${path}.of`, step.of, vars);
    if (!step.subject.startsWith('property:')) return;
    const declared = new Set<string>();
    for (const t of Object.values(this.file.types ?? {}))
      for (const p of Object.values(t.properties))
        if (p.personal !== undefined) declared.add(p.personal.subject);
    if (!declared.has(step.subject))
      this.sink.dangling(`${path}.subject`, 'personal_subject', step.subject, [...declared].sort());
  }

  /** Resolves `prop` on the subject (created feature or `self`) or `name.prop` on a bound feature. */
  target(vars: Readonly<Record<string, Ty>>, key: string, subject: Ty | undefined): Target {
    const dot = key.indexOf('.');
    const owner = dot < 0 ? subject : vars[key.slice(0, dot)];
    const prop = dot < 0 ? key : key.slice(dot + 1);
    if (owner?.kind !== 'feature') return { def: undefined, ty: undefined };
    return { def: this.definition(owner.type, prop), ty: this.cenv.env.features[owner.type]?.[prop] };
  }

  /** Reports a `set` key that names no property of the subject or of a bound feature. */
  private exists(
    path: string,
    vars: Readonly<Record<string, Ty>>,
    key: string,
    subject: Ty | undefined,
  ): boolean {
    const dot = key.indexOf('.');
    const prop = dot < 0 ? key : key.slice(dot + 1);
    const owner = dot < 0 ? subject : vars[key.slice(0, dot)];
    if (dot >= 0 && owner === undefined) {
      const name = key.slice(0, dot);
      this.sink.dangling(
        path,
        'bound_feature',
        name,
        Object.keys(vars).filter((v) => v !== 'self' && v !== 'form'),
      );
      return false;
    }
    if (owner?.kind !== 'feature') return true;
    const fields = this.cenv.env.features[owner.type];
    if (fields && !(prop in fields)) {
      if (dot < 0) this.sink.dangling(path, 'task_subject_property', prop, Object.keys(fields));
      else this.sink.dangling(path, 'property_of', prop, Object.keys(fields), { of: key.slice(0, dot) });
      return false;
    }
    return true;
  }

  private definition(type: string, prop: string): Property | undefined {
    if (type.startsWith('$task_')) {
      const task = this.file.tasks?.[type.slice('$task_'.length)];
      const first = task
        ? this.file.types?.[Array.isArray(task.on) ? (task.on[0] ?? '') : (task.on as string)]
        : undefined;
      return first?.properties[prop];
    }
    return this.file.types?.[type]?.properties[prop];
  }

  /**
   * A `then.set` / rule `with` value (A-004 item 9): a string is always an expression, other scalars
   * are literals. A bare identifier equal to an option key of the target gets the quoting hint.
   */
  private setValue(
    path: string,
    key: string,
    value: unknown,
    vars: Readonly<Record<string, Ty>>,
    subject: Ty | undefined,
    device = true,
  ): void {
    if (!this.exists(path, vars, key, subject)) return;
    const { def, ty } = this.target(vars, key, subject);
    const options = def?.options;
    if (typeof value === 'string') {
      const inScope = value in vars || BASE_NAMES.includes(value);
      if (options && Object.hasOwn(options, value) && !inScope) {
        this.sink.error(
          path,
          'expression_type',
          `'${value}' is read as a name, not as the option key`,
          `write the option key as a string literal: "'${value}'"`,
          { variant: 'option_name', value },
        );
        return;
      }
      const expect = ty && ty.kind !== 'dyn' ? ty : undefined;
      this.expr(path, value, vars, { ...(expect ? { expect } : {}), device });
      const node = this.expressions.get(path)?.typed.ast;
      if (
        options &&
        node?.kind === 'literal' &&
        typeof node.value === 'string' &&
        !Object.hasOwn(options, node.value)
      ) {
        this.sink.error(
          path,
          'dangling_reference',
          `'${node.value}' is not an option of ${key}`,
          `use one of: ${Object.keys(options).join(', ')}`,
          { value: node.value, what: 'option_of', of: key, existing: Object.keys(options).join(', ') },
        );
      }
      return;
    }
    if (ty && def && !literalFits(value, ty)) {
      this.sink.error(
        path,
        'expression_type',
        `the literal ${JSON.stringify(value)} does not fit ${show(ty)}`,
        `set ${key} to a value of type ${show(propertyTy(def))}`,
        { variant: 'literal', literal: JSON.stringify(value), type: show(ty), property: key },
      );
    }
  }

  private autos(): void {
    for (const a of listAutos(this.file)) {
      const { entry } = a;
      // After a task's run, `self` is the feature that run created, else the one it was on.
      const self =
        a.kind === 'after'
          ? this.subjects.get(entry.after as string)
          : a.kind === 'elapsed' || a.kind === 'edge' || isSweep(entry)
            ? this.cenv.taskSelf.get(a.task)
            : T.dyn;
      const vars: Record<string, Ty> = { form: T.dyn };
      if (self) vars['self'] = self;
      if (entry.schedule !== undefined)
        checkSchedule(this.sink, a, this.cenv.taskSelf.get(a.task), (path, src) =>
          this.expr(path, src, vars, { expect: T.duration, device: false }),
        );
      if (entry.elapsed !== undefined) {
        // `from + after + offset` is the due time: from is a timestamp, the others are durations (docs/05).
        const at = (name: string): string => autoPath(a, 'elapsed', name);
        this.expr(at('from'), entry.elapsed.from, vars, { expect: T.timestamp, device: false });
        for (const name of ['after', 'offset'] as const) {
          const source = entry.elapsed[name];
          if (source !== undefined) this.expr(at(name), source, vars, { expect: T.duration, device: false });
        }
      }
      if (entry.when !== undefined) {
        const path = autoPath(a, 'when');
        this.expr(path, entry.when, vars, { expect: T.bool, device: false });
        const typed = this.expressions.get(path)?.typed;
        if (a.kind === 'edge' && typed !== undefined) checkWhenTrigger(this.sink, a, typed.ast);
      }
    }
  }

  private views(): void {
    for (const [key, view] of Object.entries(this.file.views ?? {})) {
      const filter = (path: string, type: string, source: string | undefined): void => {
        if (source === undefined) return;
        this.expr(
          path,
          source,
          { self: this.cenv.feature(type) },
          { expect: T.bool, device: false, sql: true },
        );
      };
      filter(kp('views', key, 'source', 'filter'), view.source.type, view.source.filter);
      for (const [lk, layer] of Object.entries(view.layers ?? {})) {
        if (layer.source && 'type' in layer.source)
          filter(kp('views', key, 'layers', lk, 'source', 'filter'), layer.source.type, layer.source.filter);
      }
    }
  }
}

function literalFits(value: unknown, ty: Ty): boolean {
  if (value === null || ty.kind === 'dyn') return true;
  if (typeof value === 'number') return assignable(Number.isInteger(value) ? T.int : T.double, ty);
  if (typeof value === 'boolean') return assignable(T.bool, ty);
  if (typeof value === 'object') return ty.kind === 'geometry' || ty.kind === 'list' || ty.kind === 'map';
  return true;
}
