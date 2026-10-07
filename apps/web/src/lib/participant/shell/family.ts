/**
 * The family of a feature on the map screen (B-019, v3 `MapCanvas` family stack): what the shell does with the relation
 * the feature sheet opens. v3's `onFocusRelation` isolated the relation's children on the map; for children that sit at
 * their parent (`inherit_position`) v3 fanned them out above the parent's marker instead (`focusedFamily`,
 * `family-stack-fan.ts`). `createFamilyIsolate` is that choice, in one function the sheet's `isolate` prop calls:
 * children with a position of their own go to the map's `isolate` (WP-647), children at their parent become the fan.
 * Nothing is drawn for the others, and a moved parent moves the fan (the anchor is read when the fan is placed), with
 * no write. Reads only what the opened relation names: O(children of the opened parent).
 */
import { classifyingProperty, resolveMarker } from '@ueberblick/core/marker';
import { displayName } from '@ueberblick/core/locale';
import { inheritRelations } from '@ueberblick/core/schema';
import type { Geo, Position } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, FeatureState } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import {
  createFamily,
  createFamilyFan,
  fanOf,
  markerSvgUrl,
  type FanInput,
  type FanItem,
  type MapHandle,
} from '@ueberblick/ui';
import { message, type Locale } from '../messages';

type Reads = Pick<Facts, 'feature' | 'edgesFrom'>;

const isPoint = (g: unknown): g is { type: 'Point'; coordinates: Position } =>
  typeof g === 'object' && g !== null && (g as { type?: unknown }).type === 'Point';

/** Where a feature sits by its own primary geometry (a point: the point; else `pointOnSurface`); undefined with none. */
export function ownAnchorOf(
  config: Pick<CompiledConfig, 'foldTypes'>,
  facts: Pick<Facts, 'feature'>,
  geo: Pick<Geo, 'derive'>,
): (id: FeatureId) => Position | undefined {
  return (id) => {
    const state = facts.feature(id);
    if (state === undefined) return undefined;
    const key = config.foldTypes.get(state.type)?.primaryGeometry;
    const geometry = key === undefined ? undefined : state.properties[key];
    if (geometry === undefined || geometry === null || typeof geometry !== 'object') return undefined;
    return isPoint(geometry)
      ? geometry.coordinates
      : geo.derive(geometry as never).pointOnSurface.coordinates;
  };
}

export interface FamilyIsolateDeps {
  readonly config: Pick<CompiledConfig, 'file' | 'foldTypes'>;
  readonly facts: Reads;
  readonly geo: Pick<Geo, 'derive'>;
  /** The live map, read when needed (it comes and goes). */
  readonly handle: () => MapHandle | undefined;
  readonly locale: Locale;
  readonly openFeature: (id: FeatureId) => void;
  /** Rings when features may have changed: a moved parent puts the fan again. */
  readonly changed: { subscribe(listener: () => void): () => void };
}

export interface FamilyIsolate {
  /** The relation's features, or `null` when none is open (`FeatureSheetHost`'s `isolate`). */
  isolate(ids: readonly FeatureId[] | null): void;
  /**
   * The siblings a headless stack fans out from its anchor child (B-019: the parent is hidden by the filter, the anchor
   * is an ordinary marker of its own); none closes the fan.
   */
  stack(anchor: FeatureId, siblings: readonly FeatureId[]): void;
  dispose(): void;
}

/** Marker size for a fanned child: v3 drew them slightly smaller than their ordinary marker (scale .9). */
const FAN_SCALE = 0.9;

export function createFamilyIsolate(deps: FamilyIsolateDeps): FamilyIsolate {
  const { config, facts, geo, locale } = deps;
  const types = config.file.types ?? {};
  const family = createFamily(inheritRelations(types), {
    ...facts,
    ownAnchor: ownAnchorOf(config, facts, geo),
  });
  let fan: ReturnType<typeof createFamilyFan> | undefined;
  let fanHandle: MapHandle | undefined;
  let open: { readonly parent: FeatureId; readonly ids: readonly FeatureId[] } | undefined;

  const look = (state: FeatureState) => {
    const type = types[state.type];
    const prop = type === undefined ? undefined : classifyingProperty(type);
    return resolveMarker(type ?? {}, prop === undefined ? undefined : state.properties[prop]);
  };

  function fanOpen(parent: FeatureId, siblings: readonly FeatureId[]): void {
    const handle = deps.handle();
    if (handle === undefined) return;
    if (fan === undefined || fanHandle !== handle) {
      fan?.close();
      fan = createFamilyFan(handle);
      fanHandle = handle;
    }
    const at = family.anchorOf(parent);
    if (at === undefined) return fan.close();
    const inputs: FanInput[] = [];
    const states = new Map<FeatureId, FeatureState>();
    for (const id of siblings) {
      const state = facts.feature(id);
      if (state === undefined) continue;
      states.set(id, state);
      inputs.push({
        id,
        active: state.lifecycle === 'active',
        ...(state.changedAt === undefined ? {} : { changedAt: state.changedAt }),
      });
    }
    const { fanned, overflow } = fanOf(inputs);
    const parentState = facts.feature(parent);
    const items: FanItem[] = fanned.map((f) => {
      const state = states.get(f.id) as FeatureState;
      const marker = look(state);
      const px = Math.round(marker.size * FAN_SCALE);
      return {
        id: f.id,
        label: displayName(types[state.type], state, [locale]),
        icon: { url: markerSvgUrl(marker, px), width: px, height: px },
      };
    });
    fan.open({
      parent,
      at,
      parentIconHeight: parentState === undefined ? 12 : look(parentState).size / 2,
      items,
      overflow,
      overflowLabel: message(locale, 'family_more', { count: inputs.length }),
      onChild: (id) => deps.openFeature(id),
      onOverflow: (id) => deps.openFeature(id),
    });
  }

  /** Splits what the sheet opened: children at their parent fan out, the rest is isolated on the map. */
  function apply(ids: readonly FeatureId[] | null): void {
    const handle = deps.handle();
    if (ids === null) {
      fan?.close();
      open = undefined;
      handle?.isolate?.(null);
      return;
    }
    const stacked: FeatureId[] = [];
    const own: FeatureId[] = [];
    for (const id of ids) {
      const type = facts.feature(id)?.type;
      (type !== undefined && family.inherits(type) ? stacked : own).push(id);
    }
    handle?.isolate?.(own.length > 0 ? own : null);
    const parent = stacked[0] === undefined ? undefined : family.parentOf(stacked[0]);
    open =
      parent === undefined
        ? undefined
        : { parent, ids: stacked.filter((id) => family.parentOf(id) === parent) };
    if (open === undefined) fan?.close();
    else fanOpen(open.parent, open.ids);
  }

  const stop = deps.changed.subscribe(() => {
    if (open !== undefined) fanOpen(open.parent, open.ids);
  });

  return {
    isolate: apply,
    stack(anchor, siblings) {
      open = siblings.length > 0 ? { parent: anchor, ids: siblings } : undefined;
      if (open === undefined) fan?.close();
      else fanOpen(anchor, siblings);
    },
    dispose() {
      stop();
      fan?.close();
    },
  };
}
