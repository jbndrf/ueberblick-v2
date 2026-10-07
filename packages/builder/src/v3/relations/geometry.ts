/**
 * 'Geometrie beim Erstellen' of the Beziehungen dialog (WP-396; lead-a decision, shapes in `options.ts`). The parent's
 * relation carries `inherit_position: true` for übernehmen and nothing for zeichnen and keine; which of the two the
 * child is follows from its type (a primary geometry: zeichnen). A child with its own geometry never gets
 * `inherit_position` (the engine would refuse it, `inherit_with_own_geometry`).
 */
import type { Problem } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps, setOps } from '../../lenses/task/edit';
import { DEFAULT_GEOMETRY, type RelationGeometry } from './options';

type File = ReturnType<Doc['effective']>;

export const hasOwnGeometry = (file: File, child: string): boolean =>
  file.types?.[child]?.geometry !== undefined;

/** What the file says: `inherit_position` first, else the child's own geometry decides between zeichnen and keine. */
export function readGeometry(file: File, parent: string, key: string, child: string): RelationGeometry {
  if (file.types?.[parent]?.relations?.[key]?.inherit_position === true) return 'inherit';
  return hasOwnGeometry(file, child) ? 'draw' : 'none';
}

/** The mode that can be written for `child`: a child with its own geometry can only be drawn. */
export const effectiveGeometry = (
  file: File,
  child: string,
  asked: RelationGeometry | undefined,
): RelationGeometry => (hasOwnGeometry(file, child) ? 'draw' : (asked ?? DEFAULT_GEOMETRY));

/** The engine's own problem on this relation's `inherit_position`. */
export const geometryProblem = (
  problems: readonly Problem[],
  parent: string,
  key: string,
): Problem | undefined =>
  problems.find(
    (p) =>
      p.code === 'inherit_with_own_geometry' &&
      p.path === `types.${parent}.relations.${key}.inherit_position`,
  );

/** The ops that make the relation `parent.key` read as `mode`: the key is added, set or taken away. */
export function geometryOps(doc: Doc, parent: string, key: string, mode: RelationGeometry): readonly Op[] {
  const path = `types.${parent}.relations.${key}.inherit_position`;
  const now = doc.effective().types?.[parent]?.relations?.[key]?.inherit_position === true;
  if (mode !== 'inherit') return now ? clearOps(doc, path) : [];
  if (now) return [];
  return doc.template.types?.[parent]?.relations?.[key]?.inherit_position !== undefined
    ? setOps(doc, path, true)
    : [{ kind: 'add', path, value: true }];
}
