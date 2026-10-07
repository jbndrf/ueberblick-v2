/**
 * `properties.<p>.computed` (WP-312): type-checks each expression against its property, and reports what plan could not
 * keep fresh: a `default` next to it, a write by a task, a read plan does not watch, a cycle. The checked expressions go
 * into `CompiledConfig.expressions` at `types.<t>.properties.<p>.computed`, where plan finds them.
 */
import { T, check, show, type Ty } from '../../expr/check';
import { parse } from '../../expr/parse';
import { SYSTEM_FIELD_SIGIL } from '../../registry';
import type { TemplateFile } from '../file';
import { stepProperties } from '../steps-of';
import { computedReads, orderComputed } from './computed-inputs';
import type { CompiledExpr, ProblemParams } from './contract';
import { buildEnv, propertyTy, withVars, type CompileEnv } from './env';
import { taskTypes } from './indexes';
import { kp } from './kp';
import { reportParseErrors, reportTypeErrors } from './expr-problems';
import type { Sink } from './problems';

/** `$changed_at` moves with every observation, the computed one included, so it can never settle. */
const CHANGED_AT = `${SYSTEM_FIELD_SIGIL}changed_at`;

const unsupported = (
  sink: Sink,
  path: string,
  en: string,
  de: string,
  hint: string,
  params: ProblemParams,
): void => sink.error(path, 'computed_input_unsupported', { en, de }, hint, params);

/** Reports reads that plan cannot watch for changes (relations, other features, the actor, time). */
function checkReads(
  sink: Sink,
  path: string,
  reads: ReturnType<typeof computedReads>,
  relations: ReadonlySet<string>,
  references: ReadonlySet<string>,
): void {
  const hint = 'a computed value may read only own properties of `self` and `inputs`';
  for (const f of reads.fields) {
    if (relations.has(f))
      unsupported(
        sink,
        path,
        `'${f}' is a relation: a computed property cannot read other features yet`,
        `'${f}' ist eine Relation: Eine berechnete Eigenschaft kann noch keine anderen Objekte lesen`,
        hint,
        { property: f },
      );
    if (f === CHANGED_AT)
      unsupported(
        sink,
        path,
        `'self.${CHANGED_AT}' changes with every write, so it cannot be an input`,
        `'self.${CHANGED_AT}' ändert sich mit jeder Änderung und kann keine Eingabe sein`,
        hint,
        { variant: 'changed_at', property: CHANGED_AT },
      );
  }
  for (const f of reads.dereferenced)
    if (references.has(f))
      unsupported(
        sink,
        path,
        `'self.${f}' is a reference: a computed property cannot read the referenced feature`,
        `'self.${f}' ist ein Verweis: Eine berechnete Eigenschaft kann das verwiesene Objekt nicht lesen`,
        hint,
        { variant: 'reference', property: f },
      );
  for (const name of reads.names)
    unsupported(
      sink,
      path,
      `'${name}' is not a stable input: the value would depend on who changes the feature or when`,
      `'${name}' ist keine stabile Eingabe: Der Wert hinge davon ab, wer das Objekt ändert oder wann`,
      hint,
      { variant: 'name', name },
    );
  if (reads.usesTime)
    unsupported(
      sink,
      path,
      'today() is not a stable input: the value would go stale without a change',
      'today() ist keine stabile Eingabe: Der Wert würde ohne Änderung veralten',
      hint,
      { variant: 'time' },
    );
  if (reads.bareSelf)
    unsupported(
      sink,
      path,
      '`self` as a whole cannot be watched; read its properties',
      '`self` als Ganzes lässt sich nicht beobachten; lies die Eigenschaften',
      hint,
      { variant: 'bare_self' },
    );
}

/** The type a computed expression must produce for `property`. */
const expected = (cenv: CompileEnv, ty: Ty): Ty => (ty.kind === 'feature' ? cenv.feature(ty.type) : ty);

export function checkComputed(file: TemplateFile, expressions: Map<string, CompiledExpr>, sink: Sink): void {
  const cenv = buildEnv(file);
  const known = new Map<string, Set<string>>();
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    const computed = Object.entries(type.properties).filter(([, p]) => p.computed !== undefined);
    if (computed.length === 0) continue;
    const fields = new Set(Object.keys(cenv.env.features[tk] ?? {}));
    known.set(tk, new Set(computed.map(([k]) => k)));
    const relations = new Set(Object.keys(type.relations ?? {}));
    const references = new Set(
      Object.entries(type.properties)
        .filter(([, p]) => p.type === 'reference')
        .map(([k]) => k),
    );
    const inputs = new Map<string, ReadonlySet<string>>();
    for (const [pk, p] of computed) {
      const path = kp('types', tk, 'properties', pk, 'computed');
      const source = p.computed as string;
      if (p.default !== undefined)
        sink.error(
          kp('types', tk, 'properties', pk, 'default'),
          'computed_default',
          {
            en: `${tk}.${pk} is computed, so it takes no default`,
            de: `${tk}.${pk} ist berechnet und hat keinen Standardwert`,
          },
          'remove the `default`: plan computes the first value when the feature is created',
          { type: tk, property: pk },
        );
      const parsed = parse(source);
      if (!parsed.ok) {
        reportParseErrors(sink, path, source, parsed.errors);
        continue;
      }
      const reads = computedReads(parsed.ast);
      inputs.set(pk, reads.fields);
      const missing = [...reads.fields].filter((f) => !fields.has(f));
      for (const f of missing) sink.dangling(path, 'property_of', f, [...fields].sort(), { of: tk });
      if (missing.length > 0) continue;
      checkReads(sink, path, reads, relations, references);
      const want = expected(cenv, propertyTy(p));
      const r = check(parsed.ast, withVars(cenv, { self: cenv.feature(tk) }, true), {
        expect: want.kind === 'dyn' ? T.dyn : want,
      });
      if (!r.ok) {
        reportTypeErrors(
          sink,
          path,
          source,
          r.errors,
          `change \`${source}\` so that it yields ${show(want)}, the type of ${tk}.${pk}`,
        );
        continue;
      }
      expressions.set(path, { path, source, typed: r.typed });
    }
    for (const pk of orderComputed(inputs).cyclic)
      sink.error(
        kp('types', tk, 'properties', pk, 'computed'),
        'computed_cycle',
        {
          en: `${tk}.${pk} depends on itself through computed properties`,
          de: `${tk}.${pk} hängt über berechnete Eigenschaften von sich selbst ab`,
        },
        'break the cycle: let one of the computed properties read a property that people write',
        { type: tk, property: pk },
      );
  }
  checkWrites(file, known, expressions, sink);
}

/** A form field, quick edit, location step or unprefixed `then.set` key of a task that names a computed property. */
function checkWrites(
  file: TemplateFile,
  known: ReadonlyMap<string, ReadonlySet<string>>,
  expressions: ReadonlyMap<string, CompiledExpr>,
  sink: Sink,
): void {
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const types = task.creates !== undefined ? [task.creates] : taskTypes(task);
    const isComputed = (prop: string): boolean => types.some((t) => known.get(t)?.has(prop) === true);
    /** `bind.prop`: the bound feature's type comes from the checked `bind` expression. */
    const boundComputed = (taskKey: string, target: string): boolean => {
      const dot = target.indexOf('.');
      if (dot < 0) return false;
      const ty = expressions.get(kp('tasks', taskKey, 'bind', target.slice(0, dot)))?.typed.type;
      return ty?.kind === 'feature' && known.get(ty.type)?.has(target.slice(dot + 1)) === true;
    };
    const report = (path: string, prop: string): void =>
      sink.error(
        path,
        'computed_written',
        {
          en: `task '${key}' writes the computed property '${prop}'`,
          de: `Die Aufgabe '${key}' schreibt die berechnete Eigenschaft '${prop}'`,
        },
        `remove it from the task: plan keeps '${prop}' up to date from its inputs`,
        { task: key, property: prop },
      );
    // A form may list a computed property: it is shown read-only and never written (WP-804).
    for (const f of stepProperties(task)) if (isComputed(f)) report(kp('tasks', key, 'steps'), f);
    (task.then ?? []).forEach((step, i) => {
      // With `of` the keys address those features, whose type is not the subject's (A-035).
      const oty =
        step.of !== undefined ? expressions.get(kp('tasks', key, 'then', i, 'of'))?.typed.type : undefined;
      const element = oty?.kind === 'list' ? oty.element : oty;
      const ofComputed = (target: string): boolean =>
        element?.kind === 'feature' && known.get(element.type)?.has(target) === true;
      for (const target of Object.keys(step.set ?? {})) {
        const hit =
          step.of !== undefined
            ? ofComputed(target)
            : (!target.includes('.') && isComputed(target)) || boundComputed(key, target);
        if (hit) report(kp('tasks', key, 'then', i, 'set', target), target);
      }
    });
  }
}
