/**
 * The + picker's pills: one per task the role may start with no feature (core.plan decides, through the reader), as
 * v3's `WorkflowSelector` listed one pill per Objektart (R1: no availability logic here). The pill is labelled with the
 * task's label (v3's `entry_button_label`). How the position is asked for follows the geometry kind of the type the
 * task creates: a point is placed on the map with the pin, a type without geometry opens the form at once, and a line or
 * an area is drawn on the map (`DrawOnMap`; v3 `WorkflowSelector.svelte:154-165` handed those to the draw tool).
 */
import type { Geometry } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { resolveLabel, type DrawKind } from '@ueberblick/ui';
import { chainOf, type Chain } from '../../create/chain';

/** What the person draws for a line or an area type: the kind, and whether the property takes several parts (Multi*). */
export interface DrawSpec {
  readonly kind: DrawKind;
  readonly multi: boolean;
}

export interface Pill {
  readonly taskKey: string;
  readonly label: string;
  /** The position is placed on the map with the pin; otherwise the form opens at once. */
  readonly onMap: boolean;
  /** The position is drawn on the map (a line or an area type); `onMap` is false then. */
  readonly draw?: DrawSpec;
  /** The type has a parent to link while it is placed ("Mit Eltern-Element verketten"), or sits at its parent (no pin). */
  readonly chain?: Chain;
}

export interface PillDeps {
  readonly config: Pick<CompiledConfig, 'file' | 'foldTypes'>;
  /** `reader.startableTasks()`: the tasks the actor may start with no feature. */
  readonly startable: readonly string[];
  readonly locale: string;
}

/** The registry's geometry types a person draws, with the kind and whether the type is multi-part. */
const DRAWN: Readonly<Record<string, DrawSpec>> = {
  linestring: { kind: 'linestring', multi: false },
  multilinestring: { kind: 'linestring', multi: true },
  polygon: { kind: 'polygon', multi: false },
  multipolygon: { kind: 'polygon', multi: true },
};

/** How the geometry type `kind` (a registry key) is drawn, or undefined when it is placed with the pin (a point). */
export const drawSpecOf = (kind: string | undefined): DrawSpec | undefined =>
  kind === undefined ? undefined : DRAWN[kind];

export interface Placement {
  /** The type has a position the person places with the pin. */
  readonly onMap: boolean;
  /** The type is a line or an area: the person draws it on the map. */
  readonly draw?: DrawSpec;
}

/** How the type a task creates asks for its position; a type with no geometry property asks for none. */
export function placementOf(config: PillDeps['config'], type: string | undefined): Placement {
  const key = type === undefined ? undefined : config.foldTypes.get(type as never)?.primaryGeometry;
  if (type === undefined || key === undefined) return { onMap: false };
  const kind = config.file.types?.[type]?.properties[key]?.geometry_type;
  const draw = drawSpecOf(kind);
  return draw === undefined ? { onMap: true } : { onMap: false, draw };
}

/** The pills in config order. Tasks that act on a feature are not offered here: they live on the feature sheet. */
export function creatablePills(deps: PillDeps): readonly Pill[] {
  const { config, startable, locale } = deps;
  const tasks = config.file.tasks ?? {};
  const allowed = new Set(startable);
  return Object.entries(tasks).flatMap(([taskKey, task]): Pill[] => {
    if (!allowed.has(taskKey) || (task.on !== '$map' && task.on !== '$none')) return [];
    if (task.creates === undefined) return [];
    const { onMap, draw } = placementOf(config, task.creates);
    const label = resolveLabel(task.label, locale, taskKey);
    // v3 chained a point placement only; a type at its parent has no pin and picks the parent instead (B-019)
    const found = chainOf(config.file, task.creates);
    const chain = found !== undefined && (found.inherit || (onMap && draw === undefined)) ? found : undefined;
    return [
      {
        taskKey,
        label,
        onMap,
        ...(draw === undefined ? {} : { draw }),
        ...(chain === undefined ? {} : { chain }),
      },
    ];
  });
}

/** A point as the geometry property holds it: GeoJSON, [lon, lat] (the same value a map tap or a GPS fix gives). */
export const pointAt = (lon: number, lat: number): Geometry => ({ type: 'Point', coordinates: [lon, lat] });
