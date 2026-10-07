/**
 * The linked Objekte a task's form may take a field of (owner answer A5, A-047). v3's "Verknüpftes Feld hinzufügen"
 * (`FormEditorView.svelte:486-499`, `RelatedFieldPicker.svelte`) offered the parent workflow's fields; here the
 * task's declared `bind` entries are the relations, and the properties of the Objektart a bind yields are the
 * fields. Pure. The engine's own checks stay in core; this reads the file the way the compile step does for the
 * common bind `self.<relation>` (a relation of cardinality one, or a reference property).
 */
import type { LocalizedString, Property, TemplateFile } from '@ueberblick/core';
import { labelOf } from '../../shell/location';
import { subjectTypeOf } from '../task/step-ops';

export interface BoundProperty {
  readonly key: string;
  readonly label: string;
  readonly property: Property;
  /** The form already has `<bind>.<key>`: shown greyed. */
  readonly used: boolean;
}

export interface BoundTarget {
  /** The key of the task's `bind`. */
  readonly name: string;
  /** The Objektart the bind yields. */
  readonly type: string;
  readonly typeLabel: string;
  /** The Objektart's name as the file has it (the renderer localizes it). */
  readonly label: LocalizedString;
  readonly properties: readonly BoundProperty[];
}

export const bindKey = (bind: string, property: string): string => `${bind}.${property}`;

/** `<bind>.<property>` as its two parts; undefined for a plain property key. */
export function splitBindKey(key: string): { readonly bind: string; readonly property: string } | undefined {
  const dot = key.indexOf('.');
  return dot < 0 ? undefined : { bind: key.slice(0, dot), property: key.slice(dot + 1) };
}

/** The Objektart that `self.<name>` yields from `type`: a relation of cardinality one, or a reference property. */
export function yielded(file: TemplateFile, type: string, expr: string): string | undefined {
  const name = /^\s*self\.([a-z][a-z0-9_]*)\s*$/.exec(expr)?.[1];
  const def = file.types?.[type];
  if (name === undefined || def === undefined) return undefined;
  const relation = def.relations?.[name];
  if (relation !== undefined) {
    const many = relation.derive !== undefined || relation.inverse_of !== undefined;
    return (relation.cardinality ?? (many ? 'many' : 'one')) === 'one' ? relation.to : undefined;
  }
  const prop = def.properties[name];
  return prop?.type === 'reference' ? prop.to : undefined;
}

/**
 * Binds of the task that yield one Objekt, with the properties a form field may show: not computed (written by no
 * one), not a geometry (a map matter), not the process stage (only `then.set` moves it).
 */
export function boundOf(file: TemplateFile, task: string, fallback: string, locale: string): BoundTarget[] {
  const def = file.tasks?.[task];
  if (def === undefined) return [];
  const subject = subjectTypeOf(file, task, fallback);
  const out: BoundTarget[] = [];
  for (const [name, expr] of Object.entries(def.bind ?? {})) {
    const type = yielded(file, subject, String(expr));
    const target = type === undefined ? undefined : file.types?.[type];
    if (type === undefined || target === undefined) continue;
    const stage = target.process?.property;
    out.push({
      name,
      type,
      typeLabel: labelOf(target.label, locale, type),
      label: target.label,
      properties: Object.entries(target.properties)
        .filter(([key, p]) => key !== stage && p.type !== 'geometry' && p.computed === undefined)
        .map(([key, p]) => ({
          key,
          label: labelOf(p.label, locale, key),
          property: p,
          used: bindKey(name, key) in (def.form ?? {}),
        })),
    });
  }
  return out;
}

/** What the renderer's `buildFormModel` takes as `bound`: the label of the origin and the properties. */
export function boundInput(
  file: TemplateFile,
  targets: readonly BoundTarget[],
): Record<string, { label: LocalizedString; properties: Readonly<Record<string, Property>> }> {
  return Object.fromEntries(
    targets.map((b) => [b.name, { label: b.label, properties: file.types?.[b.type]?.properties ?? {} }]),
  );
}
