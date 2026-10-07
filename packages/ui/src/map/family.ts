// The family of a feature on the map (B-019, v3 `family-stack.ts`): a child whose relation says `inherit_position` has
// no position of its own and is drawn at its parent. The anchor of such a child is read from the parent through the
// edge at the moment it is asked for, so a moved parent moves its children with nothing written and nothing copied
// (R4: no built-in property). This is the one anchor function of a child: the fan, the placement and a later
// renderer (3D, H1) or export (H6) read the same one. Pure: the device reads come in as ports.
import type { Position } from '@ueberblick/core/geo';
import type { Edge, FeatureId, Key } from '@ueberblick/core/model';

/** One way a child type takes its position: through its reference property `property`, from a `parentType` feature. */
export interface InheritedPosition {
  readonly property: string;
  readonly parentType: string;
}

/** The child types that sit at their parent: `core/schema` `inheritRelations(types)` (the shell hands it in; the kit imports no schema, WP-122.1). */
export type InheritTable = ReadonlyMap<string, readonly InheritedPosition[]>;

/** What the family reads: a feature's type, the edges that leave it, and the position it holds itself. */
export interface FamilyPorts {
  feature(id: FeatureId): { readonly type: Key } | undefined;
  edgesFrom(id: FeatureId, relation?: Key): readonly Edge[];
  /** The anchor of the feature's own primary geometry (`pointOnSurface`); undefined when it has none. */
  ownAnchor(id: FeatureId): Position | undefined;
}

export interface Family {
  /** The type has no position of its own: some relation draws it at its parent. */
  inherits(type: Key): boolean;
  /** The parent a child takes its position from: the far end of its reference edge; undefined when it has none. */
  parentOf(id: FeatureId): FeatureId | undefined;
  /** Where the feature is drawn: its own anchor, else its parent's (through the chain); undefined: not drawn. */
  anchorOf(id: FeatureId): Position | undefined;
}

/** Guards against cyclic data: a chain of inheriting children this deep ends with no anchor. */
export const MAX_FAMILY_DEPTH = 8;

export function createFamily(table: InheritTable, ports: FamilyPorts): Family {
  const via = (type: Key): readonly InheritedPosition[] => table.get(type) ?? [];

  function parentOf(id: FeatureId): FeatureId | undefined {
    const state = ports.feature(id);
    if (state === undefined) return undefined;
    for (const { property, parentType } of via(state.type)) {
      for (const e of ports.edgesFrom(id, property as Key)) {
        if (ports.feature(e.to)?.type === parentType) return e.to;
      }
    }
    return undefined;
  }

  function anchorOf(id: FeatureId, depth = 0): Position | undefined {
    if (depth > MAX_FAMILY_DEPTH) return undefined;
    const state = ports.feature(id);
    if (state === undefined) return undefined;
    if (!table.has(state.type)) return ports.ownAnchor(id);
    const parent = parentOf(id);
    return parent === undefined ? undefined : anchorOf(parent, depth + 1);
  }

  return { inherits: (type) => table.has(type), parentOf, anchorOf: (id) => anchorOf(id) };
}

/** v3's fan-out cap (`FAN_OUT_CAP`): five children, then a "+N" chip. */
export const FAN_CAP = 5;

export interface FanInput {
  readonly id: FeatureId;
  /** The child is in use (lifecycle `active`): v3 fans these out first. */
  readonly active: boolean;
  /** The newest change of the child (ISO instant), for the order within a group. */
  readonly changedAt?: string;
}

/** Active children first, then the most recent (v3 `fanOrder`); the first `cap` are fanned, the rest are counted. */
export function fanOf(
  children: readonly FanInput[],
  cap: number = FAN_CAP,
): { readonly fanned: readonly FanInput[]; readonly overflow: number } {
  const sorted = [...children].sort(
    (a, b) => Number(b.active) - Number(a.active) || (b.changedAt ?? '').localeCompare(a.changedAt ?? ''),
  );
  return { fanned: sorted.slice(0, cap), overflow: Math.max(0, sorted.length - cap) };
}
