/**
 * The derived views of a compiled config (A-005): what fold and evaluate need to know about the
 * file. Built here once, by compile() and hydrate() alike, from the effective file and its checked
 * expressions; consumers never derive their own (R1). Imports only types, the registry and the
 * key-path helper, so the participant shell can load it without Zod or the checker.
 */
import type { Expr } from '../../expr/ast';
import { children } from '../../expr/parse/walk';
import type { FoldDerivedRelation, FoldReference, FoldSchema, FoldType } from '../../fold/contract';
import type { Key } from '../../model';
import { GEO_PREDICATES, type GeoPredicate } from '../../registry';
import type { TemplateFile } from '../file';
import type { CompiledConfig, CompiledExpr } from './contract';
import { kp } from './kp';

const isPredicate = (name: string): name is GeoPredicate =>
  (GEO_PREDICATES.keys as readonly string[]).includes(name);

/** `owner.field` where `owner` is the bare name `self` or `other`; returns the field. */
function fieldOf(e: Expr, owner: 'self' | 'other'): string | undefined {
  return e.kind === 'member' && e.object.kind === 'ident' && e.object.name === owner ? e.field : undefined;
}

type Prefilter = Pick<FoldDerivedRelation, 'predicate' | 'selfProperty' | 'otherProperty'>;

/** `predicate(self.<a>, other.<b>)`. */
function prefilterOf(e: Expr): Prefilter | undefined {
  if (e.kind !== 'call' || e.target !== undefined || !isPredicate(e.name) || e.args.length !== 2) {
    return undefined;
  }
  const [a, b] = e.args as [Expr, Expr];
  const selfProperty = fieldOf(a, 'self');
  const otherProperty = fieldOf(b, 'other');
  if (selfProperty === undefined || otherProperty === undefined) return undefined;
  return { predicate: e.name, selfProperty: selfProperty as Key, otherProperty: otherProperty as Key };
}

/** The operands of a top-level `&&` chain (iterative: chains may be 20,000 long). */
function conjuncts(e: Expr): Expr[] {
  const out: Expr[] = [];
  const stack: Expr[] = [e];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next.kind === 'binary' && next.op === '&&') stack.push(next.right, next.left);
    else out.push(next);
  }
  return out;
}

export interface DeriveShape {
  /** The first top-level conjunct of the form `predicate(self.<a>, other.<b>)`. */
  readonly prefilter: Prefilter | undefined;
  /** More than the prefilter alone. */
  readonly hasCondition: boolean;
  readonly usesTime: boolean;
  /** Fields read as `self.<f>` / `other.<f>` anywhere in the expression. */
  readonly selfFields: ReadonlySet<string>;
  readonly otherFields: ReadonlySet<string>;
  /** True when a property value of self/other is dereferenced further (`self.<f>.<g>`). */
  readonly dereferences: boolean;
}

export function deriveShape(ast: Expr): DeriveShape {
  const parts = conjuncts(ast);
  const at = parts.findIndex((p) => prefilterOf(p) !== undefined);
  const prefilter = at < 0 ? undefined : prefilterOf(parts[at] as Expr);
  let usesTime = false;
  const selfFields = new Set<string>();
  const otherFields = new Set<string>();
  let dereferences = false;
  const stack: Expr[] = [ast];
  for (let e = stack.pop(); e !== undefined; e = stack.pop()) {
    if ((e.kind === 'ident' && e.name === 'now') || (e.kind === 'call' && e.name === 'today')) {
      usesTime = true;
    }
    const s = fieldOf(e, 'self');
    if (s !== undefined) selfFields.add(s);
    const o = fieldOf(e, 'other');
    if (o !== undefined) otherFields.add(o);
    if (e.kind === 'member' && (fieldOf(e.object, 'self') ?? fieldOf(e.object, 'other')) !== undefined) {
      dereferences = true;
    }
    stack.push(...children(e));
  }
  return { prefilter, hasCondition: parts.length > 1, usesTime, selfFields, otherFields, dereferences };
}

/** Records that a derive condition reads `field` of type `tk`; relations and unknown fields are harmless extras. */
function addInput(inputs: Map<string, Set<Key>>, tk: string, field: string): void {
  const set = inputs.get(tk) ?? new Set<Key>();
  set.add(field as Key);
  inputs.set(tk, set);
}

export function buildViews(
  file: TemplateFile,
  expressions: ReadonlyMap<string, CompiledExpr>,
): Pick<CompiledConfig, 'foldTypes' | 'relations'> {
  const foldTypes = new Map<Key, FoldType>();
  const relations = new Map<Key, ReadonlySet<Key>>();
  const inputs = new Map<string, Set<Key>>();
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    const geometryProperties: Key[] = [];
    const references: FoldReference[] = [];
    const relationKeys = new Set<Key>();
    for (const [pk, p] of Object.entries(type.properties)) {
      if (p.type === 'geometry') geometryProperties.push(pk as Key);
      if (p.type === 'reference' && p.to !== undefined) {
        references.push({ property: pk as Key, relation: pk as Key, to: p.to as Key });
        relationKeys.add(pk as Key);
      }
    }
    const derived: FoldDerivedRelation[] = [];
    for (const [rk, rel] of Object.entries(type.relations ?? {})) {
      relationKeys.add(rk as Key);
      if (rel.derive === undefined) continue;
      const path = kp('types', tk, 'relations', rk, 'derive');
      const ast = expressions.get(path)?.typed.ast;
      const shape = ast && deriveShape(ast);
      if (!shape?.prefilter) continue;
      derived.push({
        relation: rk as Key,
        to: rel.to as Key,
        ...shape.prefilter,
        ...(shape.hasCondition ? { condition: path } : {}),
      });
      for (const f of shape.selfFields) addInput(inputs, tk, f);
      for (const f of shape.otherFields) addInput(inputs, rel.to, f);
    }
    foldTypes.set(tk as Key, {
      geometryProperties,
      ...(type.geometry === undefined ? {} : { primaryGeometry: type.geometry as Key }),
      references,
      derived,
    });
    relations.set(tk as Key, relationKeys);
  }
  for (const [tk, ft] of foldTypes) {
    const read = inputs.get(tk);
    const geometry = new Set(ft.geometryProperties);
    const list = read ? [...read].filter((p) => !geometry.has(p)) : [];
    if (list.length > 0) foldTypes.set(tk, { ...ft, derivedInputs: list });
  }
  return { foldTypes, relations };
}

const inverseCache = new WeakMap<TemplateFile, ReadonlyMap<string, string>>();

/**
 * The `inverse` of `SqlMapping` (expr/sql/contract.ts): each `inverse_of` relation as `<type>.<field>` to the
 * relation key its edges are stored under (`inverse_of: 'baum.flaeche'` is stored as `flaeche`, on the baum
 * side). Derived from the effective file once per config and never stored; compile is its only producer (R1).
 */
export function sqlInverse(config: Pick<CompiledConfig, 'file'>): ReadonlyMap<string, string> {
  const cached = inverseCache.get(config.file);
  if (cached !== undefined) return cached;
  const out = new Map<string, string>();
  for (const [tk, type] of Object.entries(config.file.types ?? {}))
    for (const [rk, rel] of Object.entries(type.relations ?? {})) {
      const stored = rel.inverse_of?.split('.')[1];
      if (stored !== undefined) out.set(`${tk}.${rk}`, stored);
    }
  inverseCache.set(config.file, out);
  return out;
}

/** The `FoldSchema` for one stored config version (`config_versions.id`). */
export function foldSchema(config: Pick<CompiledConfig, 'foldTypes'>, configVersion: number): FoldSchema {
  return { configVersion, types: config.foldTypes };
}
