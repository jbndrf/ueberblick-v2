/**
 * What the view source needs of a family (B-019): where a child sits (at its parent, read through the edge when asked), the open count a parent carries, and the features a
 * change reaches (a changed child changes its parent's badge, a moved parent moves its children).
 */
import type { Position } from '@ueberblick/core/geo';
import type { Geo } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, FeatureState } from '@ueberblick/core/model';
import { FAMILY_OPEN_KEY } from '@ueberblick/core/marker';
import type { Facts } from '@ueberblick/core/ports';
import { inheritRelations } from '@ueberblick/core/schema';
import { createFamily, type MapFeature } from '@ueberblick/ui';
import { ownAnchorOf } from '../shell/family';
import { childrenByParent, createStacks } from './family-stack';

/** A feature drawn before is drawn differently now: its state, its open-children badge or its anchor (a moved parent). */
export const drawnDiffers = (
  a: { readonly state: FeatureState; readonly map: MapFeature },
  b: { readonly state: FeatureState; readonly map: MapFeature },
): boolean =>
  a.state !== b.state ||
  a.map.properties[FAMILY_OPEN_KEY] !== b.map.properties[FAMILY_OPEN_KEY] ||
  a.map.anchor[0] !== b.map.anchor[0] ||
  a.map.anchor[1] !== b.map.anchor[1];

type Reads = Pick<Facts, 'feature' | 'edgesFrom' | 'edgesTo'>;

export function createFamilyView(deps: { config: CompiledConfig; facts: Reads; geo: Pick<Geo, 'derive'> }) {
  const types = deps.config.file.types ?? {};
  const table = inheritRelations(types);
  const family = createFamily(table, {
    ...deps.facts,
    ownAnchor: ownAnchorOf(deps.config, deps.facts, deps.geo),
  });
  const byParent = childrenByParent(table);
  // the number of open children needs no filter: the one of the parent's own children, shown or not (v3 `openCount`)
  const stacks = createStacks({ types, table, facts: deps.facts, family, shown: () => true });
  return {
    family,
    /** The stacks over a visible set: `shown` says a feature is drawn by the view and passes the filter. */
    stacksFor: (shown: (id: FeatureId) => boolean) =>
      createStacks({ types, table, facts: deps.facts, family, shown }),
    inherits: (type: string): boolean => table.has(type),
    /** Where a child is drawn; undefined when its parent has no position. */
    anchorOf: (id: FeatureId): Position | undefined => family.anchorOf(id),
    /** The property that marks a parent with open children (v3 `openCount`); none when it has none or is no parent. */
    openProps(state: FeatureState): Record<string, number> {
      const n = byParent.has(state.type) ? stacks.openCount(state.id) : 0;
      return n > 0 ? { [FAMILY_OPEN_KEY]: n } : {};
    },
    /** The features a change of `ids` reaches too: the parents of changed children and the children of changed parents. */
    reach(ids: Iterable<FeatureId>): Set<FeatureId> {
      const out = new Set<FeatureId>(ids);
      for (const id of [...out]) {
        const type = deps.facts.feature(id)?.type;
        if (type === undefined) continue;
        const parent = table.has(type) ? family.parentOf(id) : undefined;
        if (parent !== undefined) out.add(parent);
        else if (byParent.has(type)) for (const c of stacks.childrenOf(id)) out.add(c.id);
      }
      return out;
    },
  };
}

/** The stacks of the map: a feature is shown when the view draws it and `visible` (the filter) lets it through. */
export function mapStacks(deps: {
  config: CompiledConfig;
  facts: Reads;
  geo: Pick<Geo, 'derive'>;
  source: { has(id: FeatureId): boolean };
  visible: (id: FeatureId) => boolean;
}) {
  const { source, visible, ...rest } = deps;
  return createFamilyView(rest).stacksFor((id) => source.has(id) && visible(id));
}
