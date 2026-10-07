/**
 * What the Beziehungen page writes, as document ops (WP-365, S3-14). v3's relation "Eltern -> Kind" is, in the project
 * file, a reference property on the child (`types.<child>.properties.<k>: { type: reference, to: <parent> }`) plus the
 * parent's reverse list (`types.<parent>.relations.<key>: { to: <child>, inverse_of: <child>.<k>, cardinality }`), so no
 * edge is stored twice. Headless: every function takes a `Doc` and returns the next one; the page's server module saves
 * it. Compile problems come from the Doc itself (core's checker), never from a second checker (R1).
 */
import {
  defineRegistry,
  localize,
  type KeyOf,
  type LocalizedString,
  type Problem,
  type RelationCardinality,
  relationCardinality,
} from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { slugKey } from '../../lenses/data-model/ops';
import { labelOf } from '../../shell/location';
import { attachmentOps, clashOf, clearOptionOps, onDeleteOps, optionOps, renameOps } from './option-ops';
import { effectiveGeometry, geometryOps, geometryProblem, hasOwnGeometry, readGeometry } from './geometry';
import {
  createTaskKey,
  RELATION_DEFAULTS,
  readOptions,
  type RelationGeometry,
  type RelationOptions,
} from './options';

/** One relation as the page lists it. */
export interface RelationEntry {
  /** `<parent>.<key>`: where the reverse list sits. */
  readonly id: string;
  readonly parent: string;
  readonly key: string;
  readonly child: string;
  /** The child's reference property that holds the parent. */
  readonly refKey: string;
  /** The relation's name in the page language (v3 "Name"); the key when it has no label. */
  readonly label: string;
  readonly cardinality: RelationCardinality;
  /** Anbindung and "Wenn das Eltern-Element gelöscht wird", read from the tasks and steps they are written as. */
  readonly attachment: RelationOptions['attachment'];
  readonly onDelete: RelationOptions['onDelete'];
  /** 'Geometrie beim Erstellen', read from `inherit_position` and the child type (WP-396). */
  readonly geometry: RelationGeometry;
  /** The child type has a primary geometry of its own: then only zeichnen is valid. */
  readonly childHasGeometry: boolean;
  /** The engine's `inherit_with_own_geometry` problem on this relation, in the page language. */
  readonly geometryProblem?: string;
  /** Provenance: added by the overlay, or from the template. */
  readonly source: 'template' | 'overlay';
}

export interface TypeOption {
  readonly key: string;
  readonly label: string;
  /** The type has a primary geometry (a relation to it as child can only be zeichnen). */
  readonly hasGeometry: boolean;
}

/** Why a relation edit was not made; the route turns each into the page's refusal text. */
export const RELATION_ERRORS = defineRegistry([
  { key: 'name_empty', description: 'The relation has no name (v3: the name field is required).' },
  { key: 'same_type', description: 'Parent and child are the same type (v3: relationsErrorSameWorkflow).' },
  { key: 'unknown_type', description: 'The parent or the child is not a type of the project file.' },
  { key: 'unknown_relation', description: 'The project file has no relation with this id.' },
  {
    key: 'key_clash',
    description: "A task of the project file already has the key of the relation's creating task.",
  },
  { key: 'problem', description: 'The edit would leave a compile problem in the project file.' },
  { key: 'refused', description: 'The document model refused the edit (a lock, a schema problem).' },
  { key: 'no_version', description: 'Nothing is deployed yet, so there is no draft to edit.' },
  { key: 'conflict', description: 'The draft was saved by someone else in the meantime.' },
] as const);
export type RelationErrorCode = KeyOf<typeof RELATION_ERRORS>;

export type RelationEdit =
  | { readonly ok: true; readonly doc: Doc; readonly id: string }
  | { readonly ok: false; readonly code: RelationErrorCode; readonly detail?: string };

export interface RelationInput {
  readonly name: string;
  readonly parent: string;
  readonly child: string;
  readonly cardinality: RelationCardinality;
  /** Left out: v3's defaults (Verbindlich, Kinder trennen). */
  readonly attachment?: RelationOptions['attachment'];
  readonly onDelete?: RelationOptions['onDelete'];
  /** Left out: übernehmen for a child without geometry. A child with its own geometry is always zeichnen. */
  readonly geometry?: RelationGeometry;
}

/** What the lists need of a project file: the Doc, or (before any draft) the deployed file with no provenance. */
export type RelationSource = Pick<Doc, 'effective' | 'provenance'> & { readonly problems?: Doc['problems'] };
type Types = NonNullable<ReturnType<Doc['effective']>['types']>;
const typesOf = (doc: RelationSource): Types => doc.effective().types ?? {};
const labelText = (l: LocalizedString | undefined, locale: string, key: string): string =>
  localize(l, [locale]) || key;

/** A relation key from a typed name, unique among `taken`. */
export const relationKeyOf = (name: string, taken: ReadonlySet<string>): string => slugKey(name, taken);

export function typeOptions(doc: RelationSource, locale: string): readonly TypeOption[] {
  return Object.entries(typesOf(doc))
    .map(([key, t]) => ({
      key,
      label: labelText(t.label, locale, key),
      hasGeometry: t.geometry !== undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

const problemOf = (doc: RelationSource, parent: string, key: string, locale: string) => {
  const p = geometryProblem(doc.problems?.() ?? [], parent, key);
  return p === undefined ? {} : { geometryProblem: labelOf(p.message, locale, p.code) };
};

export function listRelations(doc: RelationSource, locale: string): readonly RelationEntry[] {
  const types = typesOf(doc);
  const out: RelationEntry[] = [];
  for (const [parent, t] of Object.entries(types)) {
    for (const [key, r] of Object.entries(t.relations ?? {})) {
      if (r.inverse_of === undefined) continue;
      const [child, refKey] = r.inverse_of.split('.') as [string, string];
      if (types[child]?.properties[refKey]?.type !== 'reference') continue;
      const cardinality = relationCardinality(r);
      out.push({
        id: `${parent}.${key}`,
        parent,
        key,
        child,
        refKey,
        label: labelText(r.label, locale, key),
        cardinality,
        ...readOptions(doc.effective(), { parent, key, child, refKey, cardinality }),
        geometry: readGeometry(doc.effective(), parent, key, child),
        childHasGeometry: hasOwnGeometry(doc.effective(), child),
        ...problemOf(doc, parent, key, locale),
        source: doc.provenance(`types.${parent}.relations.${key}`) === 'added' ? 'overlay' : 'template',
      });
    }
  }
  return out;
}

/** `text` for one language: a plain string is replaced, a language object gets its entry for `locale`. */
function withLocale(existing: LocalizedString | undefined, locale: string, text: string): LocalizedString {
  if (existing === undefined || typeof existing === 'string') return { [locale]: text };
  return { ...existing, [locale]: text };
}

const removeOp = (doc: Doc, path: string): Op => ({
  kind: doc.provenance(path) === 'added' ? 'reset' : 'hide',
  path,
});

const problemKey = (p: Problem): string => `${p.code}|${p.path}|${JSON.stringify(p.message)}`;

/** The ops of one create against `doc`: the child's reference first, then the parent's reverse list. */
function createOps(doc: Doc, input: RelationInput, locale: string, keep?: string): readonly Op[] {
  const types = typesOf(doc);
  const parent = types[input.parent];
  const child = types[input.child];
  if (parent === undefined || child === undefined) return [];
  const refKey = slugKey(input.parent, new Set(Object.keys(child.properties)));
  const taken = new Set([...Object.keys(parent.relations ?? {}), ...Object.keys(parent.properties)]);
  const key = keep !== undefined && !taken.has(keep) ? keep : relationKeyOf(input.name, taken);
  const reference = {
    type: 'reference',
    to: input.parent,
    label: parent.label,
  };
  const relation = {
    to: input.child,
    label: withLocale(undefined, locale, input.name.trim()),
    inverse_of: `${input.child}.${refKey}`,
    cardinality: input.cardinality,
    ...(effectiveGeometry(doc.effective(), input.child, input.geometry) === 'inherit'
      ? { inherit_position: true }
      : {}),
  };
  return [
    { kind: 'add', path: `types.${input.child}.properties.${refKey}`, value: reference },
    parent.relations === undefined
      ? { kind: 'add', path: `types.${input.parent}.relations`, value: { [key]: relation } }
      : { kind: 'add', path: `types.${input.parent}.relations.${key}`, value: relation },
  ];
}

function deleteOps(doc: Doc, e: RelationEntry): readonly Op[] {
  const map = `types.${e.parent}.relations`;
  const keys = Object.keys(typesOf(doc)[e.parent]?.relations ?? {});
  return [
    removeOp(doc, `${map}.${e.key}`),
    // The map the first relation added goes with the last one, so a draft-only relation leaves no trace.
    ...(doc.provenance(map) === 'added' && keys.length === 1 ? [{ kind: 'reset', path: map } as const] : []),
    removeOp(doc, `types.${e.child}.properties.${e.refKey}`),
  ];
}

/** Applies `ops`; refuses on the Doc's own refusal, or when a problem appears that the document did not have. */
function run(
  doc: Doc,
  steps: readonly ((d: Doc) => readonly Op[])[],
  id: string,
  locale: string,
): RelationEdit {
  const before = new Set(doc.problems().map(problemKey));
  let cur = doc;
  let problems = doc.problems();
  for (const step of steps) {
    for (const op of step(cur)) {
      const r = cur.apply(op);
      if (r.refused !== undefined) return { ok: false, code: 'refused', detail: r.refused.message };
      cur = r.doc;
      problems = r.problems;
    }
  }
  const fresh = problems.find((p) => !before.has(problemKey(p)));
  if (fresh !== undefined)
    return { ok: false, code: 'problem', detail: labelOf(fresh.message, locale, fresh.code) };
  return { ok: true, doc: cur, id };
}

function check(doc: Doc, input: RelationInput): RelationErrorCode | null {
  if (input.name.trim() === '') return 'name_empty';
  const types = typesOf(doc);
  if (types[input.parent] === undefined || types[input.child] === undefined) return 'unknown_type';
  return input.parent === input.child ? 'same_type' : null;
}

/** The relation `d` has that `before` (minus `except`) did not: the one a create or a move just wrote. */
function fresh(before: Doc, d: Doc, locale: string, except?: string): RelationEntry | undefined {
  const taken = new Set(listRelations(before, locale).map((r) => r.id));
  if (except !== undefined) taken.delete(except);
  return listRelations(d, locale).find((r) => !taken.has(r.id));
}

/** The mode a moved or edited relation keeps; zeichnen came from the old child's geometry, so it is not kept. */
const geometryKeep = (g: RelationGeometry): { geometry?: RelationGeometry } =>
  g === 'draw' ? {} : { geometry: g };

const optionsOf = (p: Partial<RelationOptions>): Partial<RelationOptions> => ({
  ...(p.attachment !== undefined ? { attachment: p.attachment } : {}),
  ...(p.onDelete !== undefined ? { onDelete: p.onDelete } : {}),
});

/** v3 "Beziehung erstellen": name, parent, child, multiplicity, Anbindung and what a parent's delete does. The key comes from the name. */
export function createRelation(doc: Doc, input: RelationInput, locale: string): RelationEdit {
  const bad = check(doc, input);
  if (bad !== null) return { ok: false, code: bad };
  const options = { ...RELATION_DEFAULTS, ...optionsOf(input) };
  const write = (d: Doc): readonly Op[] => {
    const entry = fresh(doc, d, locale);
    return entry === undefined ? [] : optionOps(d, entry, options, input.name.trim());
  };
  const r = run(doc, [(d) => createOps(d, input, locale), write], '', locale);
  if (!r.ok) return r;
  const made = fresh(doc, r.doc, locale);
  return made !== undefined && clashOf(r.doc, made) ? clash(made) : { ...r, id: made?.id ?? '' };
}

/**
 * v3 "Beziehung bearbeiten": every field can change. A new parent or child moves the reference (and keeps the key) and
 * the entries the options wrote with it. An option that is not in `patch` stays as the file has it.
 */
export function updateRelation(
  doc: Doc,
  id: string,
  patch: Partial<RelationInput>,
  locale: string,
): RelationEdit {
  const entry = listRelations(doc, locale).find((r) => r.id === id);
  if (entry === undefined) return { ok: false, code: 'unknown_relation', detail: id };
  const t = typesOf(doc)[entry.parent]?.relations?.[entry.key];
  const next: RelationInput = {
    name: patch.name ?? entry.label,
    parent: patch.parent ?? entry.parent,
    child: patch.child ?? entry.child,
    cardinality: patch.cardinality ?? entry.cardinality,
    // A mode of 'zeichnen' came from the old child's geometry: a new child without one starts at the default.
    ...geometryKeep(patch.geometry ?? entry.geometry),
  };
  const bad = check(doc, next);
  if (bad !== null) return { ok: false, code: bad };
  const options: RelationOptions = {
    attachment: entry.attachment,
    onDelete: entry.onDelete,
    ...optionsOf(patch),
  };
  const name = next.name.trim();
  const moved = next.parent !== entry.parent || next.child !== entry.child;
  if (moved) {
    const keep = next.parent === entry.parent ? entry.key : undefined;
    const write = (d: Doc): readonly Op[] => {
      const to = fresh(doc, d, locale, id);
      return to === undefined ? [] : optionOps(d, to, options, name);
    };
    const steps = [
      (d: Doc) => clearOptionOps(d, entry),
      (d: Doc) => deleteOps(d, entry),
      (d: Doc) => createOps(d, next, locale, keep),
      write,
    ];
    const r = run(doc, steps, id, locale);
    if (!r.ok) return r;
    const to = fresh(doc, r.doc, locale, id);
    return to !== undefined && clashOf(r.doc, to) ? clash(to) : { ...r, id: to?.id ?? id };
  }
  const base = `types.${entry.parent}.relations.${entry.key}`;
  const ops: Op[] = [];
  if (name !== entry.label) {
    ops.push({ kind: 'set', path: `${base}.label`, value: withLocale(t?.label, locale, name) });
    ops.push(...renameOps(doc, entry, entry.label, name));
  }
  if (next.cardinality !== entry.cardinality)
    ops.push({ kind: 'set', path: `${base}.cardinality`, value: next.cardinality });
  const writeOptions = (d: Doc): readonly Op[] => [
    ...(patch.geometry !== undefined
      ? geometryOps(d, entry.parent, entry.key, effectiveGeometry(d.effective(), entry.child, patch.geometry))
      : []),
    ...(options.attachment !== entry.attachment ? attachmentOps(d, entry, options.attachment, name) : []),
    ...(options.onDelete !== entry.onDelete
      ? onDeleteOps(d, { ...entry, cardinality: next.cardinality }, options.onDelete)
      : []),
  ];
  const r = run(doc, [() => ops, writeOptions], id, locale);
  return r.ok && options.attachment !== entry.attachment && clashOf(r.doc, entry) ? clash(entry) : r;
}

/** The refusal for a creating-task key that an author's task already uses (nothing is saved). */
const clash = (e: RelationEntry): RelationEdit => ({
  ok: false,
  code: 'key_clash',
  detail: createTaskKey(e),
});

export interface RelationDeletion {
  readonly doc: Doc;
  /** The type that held the reference and its property key: the page counts the features that hold it. */
  readonly child: string;
  readonly refKey: string;
  /** The problems the deletion causes (rules, permissions, views that named the reference): the Doc's own, new ones. */
  readonly uses: readonly Problem[];
}

/**
 * Deletes a relation: the overlay's own is dropped (`reset`), one of the template is hidden (`hide`). `uses` are the
 * problems that appear with the deletion, straight from the Doc, so the admin sees what still names the relation.
 */
export function deleteRelation(doc: Doc, id: string): RelationDeletion | { readonly refused: string } {
  const entry = listRelations(doc, 'en').find((r) => r.id === id);
  if (entry === undefined) return { refused: id };
  const before = new Set(doc.problems().map(problemKey));
  let cur = doc;
  let problems = doc.problems();
  for (const op of [...clearOptionOps(doc, entry), ...deleteOps(doc, entry)]) {
    const r = cur.apply(op);
    if (r.refused !== undefined) return { refused: r.refused.message };
    cur = r.doc;
    problems = r.problems;
  }
  return {
    doc: cur,
    child: entry.child,
    refKey: entry.refKey,
    uses: problems.filter((p) => !before.has(problemKey(p))),
  };
}
