/**
 * The family stack of the map (B-019, v3 `family-stack.ts` `computeFamilyStacks`), over the FILTER-VISIBLE set:
 *  - the parent shows: its children at its position hide behind it (the relation in the feature sheet fans them out);
 *  - the parent is hidden by the filter and >= 2 of its children show: the top child (v3 `fanOrder`: active first, then
 *    newest) is an ordinary marker that anchors the stack, the others hide and fan out on tap; a lone child is an
 *    ordinary marker;
 *  - `openCount` is v3's `FamilyStack.openCount` (the open daughters). Open here = lifecycle `active` and not at an end
 *    stage of the child type's process (read from the type, no stage name in code).
 * Every read is of one parent's edges, so a feature costs O(children of its parent), never O(all features) (R14).
 */
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { fanOf, type Family, type InheritTable } from '@ueberblick/ui';

type Reads = Pick<Facts, 'feature' | 'edgesTo'>;
interface ProcessDecl {
  readonly property: string;
  readonly end: readonly string[];
}
export type ProcessTypes = Readonly<Record<string, { readonly process?: ProcessDecl | undefined }>>;

interface ChildVia {
  readonly childType: string;
  readonly property: string;
}

/** For a parent type: the child types that sit at it, with the reference property that points to it. */
export function childrenByParent(table: InheritTable): ReadonlyMap<string, readonly ChildVia[]> {
  const out = new Map<string, ChildVia[]>();
  for (const [childType, via] of table) {
    for (const { property, parentType } of via) {
      const list = out.get(parentType) ?? [];
      list.push({ childType, property });
      out.set(parentType, list);
    }
  }
  return out;
}

/** Whether a child is open: in use and not at an end stage of its type's process. */
export function isOpen(types: ProcessTypes, state: FeatureState): boolean {
  if (state.lifecycle !== 'active') return false;
  const process = types[state.type]?.process;
  if (process === undefined) return true;
  const stage = state.properties[process.property];
  return !(typeof stage === 'string' && process.end.includes(stage));
}

export interface Stacks {
  /** The children of `parent` (any child type), as features. */
  childrenOf(parent: FeatureId): readonly FeatureState[];
  /** v3 `openCount`: the open children of a parent. */
  openCount(parent: FeatureId): number;
  /** The open children of a parent that are shown (their type is switched on and their layer's filter lets them through). */
  shownOpenCount(parent: FeatureId): number;
  /** The child is drawn behind its parent's marker or behind the top sibling of a headless stack: not drawn itself. */
  hidden(child: FeatureId): boolean;
  /** The other children a headless stack fans out from `anchor` (empty when `anchor` anchors none), in fan order. */
  headless(anchor: FeatureId): readonly FeatureId[];
}

export interface StackDeps {
  readonly types: ProcessTypes;
  readonly table: InheritTable;
  readonly facts: Reads;
  readonly family: Family;
  /** The feature is drawn by the view and passes the active filter (parent or child alike). */
  readonly shown: (id: FeatureId) => boolean;
}

export function createStacks(deps: StackDeps): Stacks {
  const { facts, family } = deps;
  const byParent = childrenByParent(deps.table);

  function childrenOf(parent: FeatureId): FeatureState[] {
    const type = facts.feature(parent)?.type;
    const out: FeatureState[] = [];
    for (const { childType, property } of type === undefined ? [] : (byParent.get(type) ?? [])) {
      for (const e of facts.edgesTo(parent, property as Key)) {
        const c = facts.feature(e.from);
        if (c !== undefined && c.type === childType) out.push(c);
      }
    }
    return out;
  }

  /** The shown children of a hidden parent, in fan order (active first, newest first). */
  function group(parent: FeatureId): readonly FeatureId[] {
    const kids = childrenOf(parent).filter((c) => deps.shown(c.id));
    return fanOf(
      kids.map((c) => ({
        id: c.id,
        active: c.lifecycle === 'active',
        ...(c.changedAt === undefined ? {} : { changedAt: c.changedAt }),
      })),
      Number.POSITIVE_INFINITY,
    ).fanned.map((f) => f.id);
  }

  return {
    childrenOf,
    openCount: (parent) => childrenOf(parent).filter((c) => isOpen(deps.types, c)).length,
    shownOpenCount: (parent) =>
      childrenOf(parent).filter((c) => isOpen(deps.types, c) && deps.shown(c.id)).length,
    hidden(child) {
      const parent = family.parentOf(child);
      if (parent === undefined) return false;
      if (deps.shown(parent)) return true;
      const g = group(parent);
      return g.length >= 2 && g[0] !== child;
    },
    headless(anchor) {
      const parent = family.parentOf(anchor);
      if (parent === undefined || deps.shown(parent)) return [];
      const g = group(parent);
      return g.length >= 2 && g[0] === anchor ? g.slice(1) : [];
    },
  };
}
