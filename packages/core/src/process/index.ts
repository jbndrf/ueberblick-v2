/**
 * The process of a feature type (docs/04 "Process", A-028): the stage property with its start and
 * end stages. Compile checks the declaration; everything else reads it through `processesOf`, so the
 * list is the one seam for a later second process per type.
 */
import type { Key } from '../model';
import type { FeatureType } from '../schema';

export interface Process {
  /** The key of the `select` property that holds the stage. */
  readonly property: Key;
  /** The stage a new feature starts in. */
  readonly start: Key;
  /** The stages that end the process. */
  readonly end: readonly Key[];
  /** Every stage: the option keys of the property, in declaration order. */
  readonly options: readonly Key[];
}

/** The processes of a type: 0 or 1 entries today. */
export function processesOf(type: FeatureType): readonly Process[] {
  const decl = type.process;
  if (decl === undefined) return [];
  const options = Object.keys(type.properties[decl.property]?.options ?? {}) as Key[];
  return [{ property: decl.property as Key, start: decl.start as Key, end: decl.end as Key[], options }];
}
