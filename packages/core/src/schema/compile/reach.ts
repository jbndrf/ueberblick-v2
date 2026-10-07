/**
 * Reachability warnings: select options nothing can set, and tasks whose `when` can never be true.
 * Both are conservative: they report only what is provable from the file, so a warning is never noise.
 */
import type { Expr } from '../../expr/ast';
import { ACTOR_KINDS } from '../../registry';
import type { TemplateFile } from '../file';
import type { Task } from '../task';
import { stepProperties } from '../steps-of';
import { taskTypes } from './indexes';
import { kp } from './kp';
import type { CompiledExpr } from './contract';
import type { Sink } from './problems';

const isOptionType = (t: string): boolean => t === 'select' || t === 'multiselect';

/** Options that no default, form field, `then` step or role preset can ever set. */
export function checkDeadOptions(
  file: TemplateFile,
  expressions: ReadonlyMap<string, CompiledExpr>,
  sink: Sink,
): void {
  const reachable = new Map<string, Set<string> | 'all'>(); // `type.prop` -> options
  const add = (id: string, options: Iterable<string> | 'all'): void => {
    const cur = reachable.get(id);
    if (cur === 'all') return;
    if (options === 'all') {
      reachable.set(id, 'all');
      return;
    }
    const set = cur ?? new Set<string>();
    for (const o of options) set.add(o);
    reachable.set(id, set);
  };
  const propIds = new Map<string, string[]>(); // prop key -> ids of all option properties with it
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    for (const [pk, p] of Object.entries(type.properties)) {
      if (!isOptionType(p.type)) continue;
      // A computed select gets its options from its expression, not from a task or default.
      if (p.computed !== undefined) {
        add(`${tk}.${pk}`, 'all');
        continue;
      }
      propIds.set(pk, [...(propIds.get(pk) ?? []), `${tk}.${pk}`]);
      add(
        `${tk}.${pk}`,
        [p.default].flat().filter((v): v is string => typeof v === 'string'),
      );
    }
    // A new feature starts in the process `start`, which replaces a default (A-028).
    if (type.process !== undefined) add(`${tk}.${type.process.property}`, [type.process.start]);
  }
  const idsFor = (types: readonly string[], prop: string): string[] =>
    types.length === 0
      ? (propIds.get(prop) ?? [])
      : types.map((t) => `${t}.${prop}`).filter((id) => reachable.has(id));

  /** The options a `set` or `with` value can produce: a string literal is one option, anything else could be any. */
  const optionsOf = (path: string, value: unknown): Iterable<string> | 'all' => {
    if (typeof value !== 'string') return [];
    const ast = expressions.get(path)?.typed.ast;
    return ast?.kind === 'literal' && typeof ast.value === 'string' ? [ast.value] : 'all';
  };
  /** The types whose properties a task's form and `set` keys address: the created type, else where it is offered. */
  const subjectTypes = (task: Task): readonly string[] =>
    task.creates !== undefined ? [task.creates] : taskTypes(task);

  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const types = subjectTypes(task);
    for (const fk of [...Object.keys(task.form ?? {}), ...stepProperties(task)]) {
      // `<bind>.<property>`: the bound type is not known here, count every option property of that name.
      const bound = fk.includes('.');
      for (const id of idsFor(bound ? [] : types, bound ? fk.slice(fk.indexOf('.') + 1) : fk)) add(id, 'all');
    }
    (task.then ?? []).forEach((step, i) => {
      for (const [target, value] of Object.entries(step.set ?? {})) {
        // A bound feature's, or an `of` target's, type is not the subject's.
        const bound = target.includes('.') || step.of !== undefined;
        const prop = bound ? target.slice(target.indexOf('.') + 1) : target;
        // A bound feature's type is not known here: count every option property of that name.
        for (const id of idsFor(bound ? [] : types, prop)) {
          add(id, optionsOf(kp('tasks', key, 'then', i, 'set', target), value));
        }
      }
    });
  }
  for (const role of Object.values(file.roles ?? {})) {
    for (const preset of Object.values(role.app?.presets ?? {})) {
      for (const [prop, value] of Object.entries(preset)) {
        for (const id of propIds.get(prop) ?? []) add(id, presetOptions(value));
      }
    }
  }

  for (const [tk, type] of Object.entries(file.types ?? {})) {
    for (const [pk, p] of Object.entries(type.properties)) {
      const got = reachable.get(`${tk}.${pk}`);
      if (!isOptionType(p.type) || got === 'all') continue;
      for (const o of Object.keys(p.options ?? {})) {
        if (got?.has(o)) continue;
        sink.warn(
          kp('types', tk, 'properties', pk, 'options', o),
          'dead_option',
          `option '${o}' of ${tk}.${pk} is never set by a default, form or task step`,
          `add a \`then\` step \`set: { ${pk}: "'${o}'" }\` to a task on ${tk}, make it the default, or remove the option (data that used it needs a migration)`,
          { option: o, type: tk, property: pk },
        );
      }
    }
  }
}

/** Role presets hold plain values, not expressions: a string is an option key. */
function presetOptions(value: unknown): Iterable<string> {
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
}

// --- never available ---------------------------------------------------------------------------

interface Facts {
  readonly roles: readonly string[];
  /** Option keys of `self.<prop>` for this task, when it has exactly one type. */
  readonly selfOptions: (prop: string) => readonly string[] | undefined;
}

/** `self.stage` or `actor.kind` as a dotted string, or undefined for anything else. */
function pathOf(e: Expr): string | undefined {
  if (e.kind === 'ident') return e.name;
  if (e.kind === 'member') {
    const o = pathOf(e.object);
    return o === undefined ? undefined : `${o}.${e.field}`;
  }
  return undefined;
}

const literalOf = (e: Expr): string | number | boolean | undefined =>
  e.kind === 'literal' && e.value !== null ? e.value : undefined;

/** True when `path == literal` can never hold. */
function impossible(path: string, lit: string | number | boolean, facts: Facts): boolean {
  if (path === 'actor.kind' && typeof lit === 'string')
    return !(ACTOR_KINDS.keys as readonly string[]).includes(lit);
  if (path.startsWith('self.') && typeof lit === 'string') {
    const options = facts.selfOptions(path.slice(5));
    return options !== undefined && !options.includes(lit);
  }
  return false;
}

function conjuncts(e: Expr): Expr[] {
  return e.kind === 'binary' && e.op === '&&' ? [...conjuncts(e.left), ...conjuncts(e.right)] : [e];
}

function isFalse(e: Expr, f: Facts): boolean {
  switch (e.kind) {
    case 'literal':
      return e.value === false;
    case 'unary':
      return e.op === '!' && isTrue(e.operand);
    case 'binary':
      if (e.op === '||') return isFalse(e.left, f) && isFalse(e.right, f);
      if (e.op === '&&') return conjunctsFalse(e, f);
      if (e.op === '==')
        return equalityImpossible(e.left, e.right, f) || equalityImpossible(e.right, e.left, f);
      if (e.op === 'in' && pathOf(e.right) === 'actor.roles') {
        const lit = literalOf(e.left);
        return typeof lit === 'string' && f.roles.length > 0 && !f.roles.includes(lit);
      }
      if (e.op === 'in' && e.right.kind === 'list') {
        const path = pathOf(e.left);
        const lits = e.right.elements.map(literalOf);
        return path !== undefined && lits.every((l) => l !== undefined && impossible(path, l, f));
      }
      return false;
    default:
      return false;
  }
}

function equalityImpossible(a: Expr, b: Expr, f: Facts): boolean {
  const path = pathOf(a);
  const lit = literalOf(b);
  return path !== undefined && lit !== undefined && impossible(path, lit, f);
}

function conjunctsFalse(e: Expr, f: Facts): boolean {
  const parts = conjuncts(e);
  if (parts.some((p) => isFalse(p, f))) return true;
  const seen = new Map<string, string | number | boolean>();
  for (const p of parts) {
    if (p.kind !== 'binary' || p.op !== '==') continue;
    const [path, lit] =
      pathOf(p.left) !== undefined
        ? [pathOf(p.left), literalOf(p.right)]
        : [pathOf(p.right), literalOf(p.left)];
    if (path === undefined || lit === undefined) continue;
    const prev = seen.get(path);
    if (prev !== undefined && prev !== lit) return true;
    seen.set(path, lit);
  }
  return false;
}

function isTrue(e: Expr): boolean {
  if (e.kind === 'literal') return e.value === true;
  if (e.kind === 'binary' && e.op === '&&') return isTrue(e.left) && isTrue(e.right);
  if (e.kind === 'binary' && e.op === '||') return isTrue(e.left) || isTrue(e.right);
  return false;
}

/** Warns for each task whose `when` is provably never true. */
export function checkAvailability(
  file: TemplateFile,
  expressions: ReadonlyMap<string, CompiledExpr>,
  sink: Sink,
): void {
  const roles = Object.keys(file.roles ?? {});
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const compiled = expressions.get(kp('tasks', key, 'when'));
    if (!compiled) continue;
    const facts: Facts = { roles, selfOptions: (prop) => selfOptions(file, task, prop) };
    if (isFalse(compiled.typed.ast, facts)) {
      sink.warn(
        kp('tasks', key, 'when'),
        'never_available',
        `task '${key}' can never be available: \`${compiled.source}\` is never true`,
        'change the condition so that some feature and actor satisfy it, or remove the task',
        { task: key, source: compiled.source },
      );
    }
  }
}

function selfOptions(file: TemplateFile, task: Task, prop: string): readonly string[] | undefined {
  const [only, ...rest] = taskTypes(task);
  if (only === undefined || rest.length > 0) return undefined;
  const p = file.types?.[only]?.properties[prop];
  return p && isOptionType(p.type) && p.options ? Object.keys(p.options) : undefined;
}
