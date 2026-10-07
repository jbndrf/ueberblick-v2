/** Reference edges (F9): a property value that is a FeatureId, or a list of them. */
import type { Edge, FeatureId, Json, Key } from '../model';
import type { EdgeChanges, FoldedFeature, FoldSchema } from './contract';

function targets(value: Json | undefined): FeatureId[] {
  if (typeof value === 'string') return [value as FeatureId];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string') as FeatureId[];
  return [];
}

/** Edges for the reference properties in `changed`: old ones out, current ones in. */
export function referenceEdges(
  prev: FoldedFeature | undefined,
  next: FoldedFeature,
  changed: readonly string[],
  schema: FoldSchema,
): EdgeChanges {
  const refs = schema.types.get(next.type)?.references ?? [];
  const put: Edge[] = [];
  const remove: Edge[] = [];
  const edge = (relation: Key, to: FeatureId): Edge => ({ from: next.id, relation, to, derived: false });
  for (const ref of refs) {
    const typeSwitched = prev !== undefined && prev.type !== next.type;
    if (!changed.includes(ref.property) && !typeSwitched) continue;
    const now = new Set(targets(next.properties[ref.property]));
    const before = new Set(targets(prev?.properties[ref.property]));
    for (const to of now) put.push(edge(ref.relation, to));
    for (const to of before) if (!now.has(to)) remove.push(edge(ref.relation, to));
  }
  return { put, remove };
}
