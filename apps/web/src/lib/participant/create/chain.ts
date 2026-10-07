/**
 * "Mit Eltern-Element verketten" (B-019, v3 `+page.svelte:2044-2149`, `WorkflowSelector.svelte:279-340`): while a new
 * object is placed, the person may tap the parent it belongs to; the pin snaps onto it and the parent is linked.
 * v3 offered it when an `optional` parent-child relation had the placed workflow as its child. In v4 a relation is a
 * reference property of the child that the parent lists through `inverse_of` (the hierarchy, WP-647); the optional one
 * is a reference that is not `required`. A type whose relation says `inherit_position` has no pin: the parent is its
 * position, so picking the parent is the whole placement.
 */
import { displayName } from '@ueberblick/core/locale';
import { inheritRelations } from '@ueberblick/core/schema';
import type { Bbox, Geo, Position } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, Key } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { isServed } from '@ueberblick/core/registry';
import { hierarchyGroups } from '../feature/relations/nav';
import { ownAnchorOf } from '../shell/family';

/** One way to link the new object: its reference `property`, pointing at features of `parentType`. */
export interface ChainRelation {
  readonly property: string;
  readonly parentType: string;
}

export interface Chain {
  readonly relations: readonly ChainRelation[];
  /** The type sits at its parent (`inherit_position`): no pin, and the parent must be picked. */
  readonly inherit: boolean;
}

/** v3 marked every candidate; a view with more than this keeps the nearest ones, so the cost stays bounded (R14). */
export const MAX_CANDIDATES = 100;

/** The chain a new object of `type` offers, or undefined when it has no parent relation to link. */
export function chainOf(file: CompiledConfig['file'], type: string | undefined): Chain | undefined {
  const decl = type === undefined ? undefined : file.types?.[type];
  if (type === undefined || decl === undefined) return undefined;
  const inherited = inheritRelations(file.types ?? {}).get(type);
  if (inherited !== undefined) return { relations: inherited.map((r) => ({ ...r })), inherit: true };
  const hierarchy = hierarchyGroups(file);
  const relations = Object.entries(decl.properties).flatMap(([property, p]): ChainRelation[] =>
    p.type === 'reference' &&
    p.to !== undefined &&
    p.required !== true &&
    hierarchy.has(`${type}.${property}`)
      ? [{ property, parentType: p.to }]
      : [],
  );
  return relations.length === 0 ? undefined : { relations, inherit: false };
}

/** A parent the person may tap: its name for the ring's label, where it is drawn, and the relation it would fill. */
export interface Candidate {
  readonly id: FeatureId;
  readonly label: string;
  readonly at: Position;
  readonly relation: ChainRelation;
}

export interface CandidateDeps {
  readonly config: Pick<CompiledConfig, 'file' | 'foldTypes'>;
  readonly facts: Pick<Facts, 'feature' | 'near'>;
  readonly geo: Pick<Geo, 'derive'>;
  readonly locale: string;
}

const dist2 = (a: Position, b: Position): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** The parents of the chain's types inside `extent`, nearest to `around` first, at most MAX_CANDIDATES: O(parents in view). */
export function candidatesIn(deps: CandidateDeps, chain: Chain, extent: Bbox, around: Position): Candidate[] {
  const own = ownAnchorOf(deps.config, deps.facts, deps.geo);
  const out: Candidate[] = [];
  for (const relation of chain.relations) {
    for (const state of deps.facts.near(relation.parentType as Key, extent)) {
      if (!isServed(state.lifecycle)) continue;
      const at = own(state.id);
      if (at === undefined) continue;
      out.push({
        id: state.id,
        label: displayName(deps.config.file.types?.[state.type], state, [deps.locale]),
        at,
        relation,
      });
    }
  }
  return out.sort((a, b) => dist2(a.at, around) - dist2(b.at, around)).slice(0, MAX_CANDIDATES);
}
