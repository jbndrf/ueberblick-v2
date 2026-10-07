/**
 * Berechnet (v3 "Vom Server berechnet", Erweitert block; owner Q29, engine WP-312): a property whose value is an
 * expression over the other properties of the feature, kept up to date by the plan on the device and the server.
 * Pure: the expression's inputs for the list under the editor, and the ops that set or remove it (R1).
 */
import { formatKeyPath, type TemplateFile } from '@ueberblick/core';
import { parse } from '@ueberblick/core/expr/compile';
import type { Doc, Op } from '../../doc';
import { clearOps, setOps } from '../../lenses/task/edit';
import { labelOf } from '../../shell/location';

export interface Dependency {
  readonly key: string;
  /** The label of the property; `null` when the type has no such property (v3: a red "Unbekanntes Feld" chip). */
  readonly label: string | null;
}

/** Every `self.<key>` the source reads, once each, in order of appearance. Empty for a source that does not parse. */
export function selfReads(source: string): string[] {
  const parsed = parse(source);
  if (!parsed.ok) return [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object' || node === null) return;
    const n = node as { kind?: string; object?: { kind?: string; name?: string }; field?: string };
    if (
      n.kind === 'member' &&
      n.object?.kind === 'ident' &&
      n.object.name === 'self' &&
      n.field !== undefined
    )
      seen.add(n.field);
    for (const v of Object.values(node)) walk(v);
  };
  walk(parsed.ast);
  return [...seen];
}

export function dependenciesOf(
  source: string,
  file: TemplateFile,
  type: string,
  locale: string,
): readonly Dependency[] {
  const properties = file.types?.[type]?.properties ?? {};
  return selfReads(source).map((key) => {
    const p = properties[key];
    return { key, label: p === undefined ? null : labelOf(p.label, locale, key) };
  });
}

const path = (type: string, key: string): string =>
  formatKeyPath(['types', type, 'properties', key, 'computed']);

/** The expression of the property; an empty text takes Berechnet off. */
export function computedOps(doc: Doc, type: string, key: string, source: string): readonly Op[] {
  const text = source.trim();
  return text === '' ? clearOps(doc, path(type, key)) : setOps(doc, path(type, key), text);
}
