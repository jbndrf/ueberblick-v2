/**
 * Generates the `expr.check` environment from the file. This is the only place it is built (R1):
 * property types become expression types, relations and reference properties become features.
 */
import { T, listOf, show, type Env, type Ty } from '../../expr/check';
import { SYSTEM_FIELDS, SYSTEM_FIELD_SIGIL, type PropertyTypeKey } from '../../registry';
import type { TemplateFile } from '../file';
import type { Property } from '../property';
import { relationCardinality } from '../relation-cardinality';
import { taskTypes } from './indexes';

/** The expression type of a property value. `reference` becomes a feature of the target type. */
const PROPERTY_TY: Record<PropertyTypeKey, (p: Property) => Ty> = {
  text: () => T.string,
  localized_text: () => T.dyn,
  number: () => T.double,
  integer: () => T.int,
  boolean: () => T.bool,
  date: () => T.timestamp,
  datetime: () => T.timestamp,
  time: () => T.string,
  select: () => T.string,
  multiselect: () => listOf(T.string),
  geometry: () => T.geometry,
  participant: (p) => (p.cardinality === 'many' ? listOf(T.string) : T.string),
  role: (p) => (p.cardinality === 'many' ? listOf(T.string) : T.string),
  reference: (p) => {
    const one: Ty = { kind: 'feature', type: p.to ?? '' };
    return p.cardinality === 'many' ? listOf(one) : one;
  },
  file: () => T.string,
};

export const propertyTy = (p: Property): Ty => PROPERTY_TY[p.type](p);

const actorTy: Ty = {
  kind: 'record',
  fields: { id: T.string, roles: listOf(T.string), kind: T.string },
};

export interface CompileEnv {
  readonly env: Env;
  /** `inputs`: one field per declared input. */
  readonly inputsTy: Ty;
  readonly actorTy: Ty;
  /** The type of `self` per task (absent for `map` and `none` tasks). */
  readonly taskSelf: ReadonlyMap<string, Ty>;
  /** A feature of the named type, or an untyped value when the type does not exist. */
  readonly feature: (name: string) => Ty;
}

/** The properties every listed type declares with the same type: `self` of a multi-type task. */
function commonFields(
  keys: readonly string[],
  features: Record<string, Record<string, Ty>>,
): Record<string, Ty> {
  const [first, ...rest] = keys.map((k) => features[k] ?? {});
  const out: Record<string, Ty> = {};
  for (const [name, ty] of Object.entries(first ?? {})) {
    if (rest.every((f) => f[name] !== undefined && show(f[name] as Ty) === show(ty))) out[name] = ty;
  }
  return out;
}

export function buildEnv(file: TemplateFile): CompileEnv {
  const features: Record<string, Record<string, Ty>> = {};
  const known = new Set(Object.keys(file.types ?? {}));
  // A feature type that does not exist is reported as a dangling reference; here it stays untyped
  // so that one mistake does not produce a second, misleading expression error.
  const feature = (name: string): Ty => (known.has(name) ? { kind: 'feature', type: name } : T.dyn);
  const tyOf = (p: Property): Ty => {
    const ty = propertyTy(p);
    return ty.kind === 'feature' ? feature(ty.type) : ty;
  };
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    const fields: Record<string, Ty> = {};
    if (type.geometry !== undefined) fields['geometry'] = T.geometry;
    for (const [pk, p] of Object.entries(type.properties)) fields[pk] = tyOf(p);
    for (const [rk, r] of Object.entries(type.relations ?? {})) {
      // one: a feature; many (the default for derive and inverse_of): a list of features (A-004 item 3).
      fields[rk] = relationCardinality(r) === 'one' ? feature(r.to) : listOf(feature(r.to));
    }
    // The system fields (`self.$created_by`, ...): every feature type has them, so a rule may read them on any `self`.
    for (const f of SYSTEM_FIELDS.entries) fields[`${SYSTEM_FIELD_SIGIL}${f.key}`] = T[f.type];
    features[tk] = fields;
  }
  const taskSelf = new Map<string, Ty>();
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const on = taskTypes(task);
    const [only] = on;
    if (on.some((t) => !known.has(t))) taskSelf.set(key, T.dyn);
    else if (on.length === 1 && only !== undefined) taskSelf.set(key, feature(only));
    else if (on.length > 1) {
      const synthetic = `$task_${key}`;
      features[synthetic] = commonFields(on, features);
      taskSelf.set(key, { kind: 'feature', type: synthetic });
    }
  }
  const inputs: Record<string, Ty> = {};
  for (const [k, p] of Object.entries(file.inputs ?? {})) inputs[k] = tyOf(p);
  const inputsTy: Ty = { kind: 'record', fields: inputs };
  return { env: { vars: {}, features }, inputsTy, actorTy, taskSelf, feature };
}

/** Variables in scope for one expression: the base ones plus whatever the context adds. */
export function withVars(
  base: CompileEnv,
  vars: Readonly<Record<string, Ty>>,
  device: boolean,
  sql = false,
): Env {
  return {
    vars: { actor: base.actorTy, inputs: base.inputsTy, now: T.timestamp, ...vars },
    features: base.env.features,
    device,
    sql,
  };
}
