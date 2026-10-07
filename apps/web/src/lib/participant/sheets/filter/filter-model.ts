/**
 * What the Einfach tab shows, computed from the features on the device (never fetched): one card per Objektart that
 * has features, and for an Objektart with a process one row per stage, in declaration order (a stage has an order;
 * v3 sorted its values by label). All declared stages are listed, also with count 0, so a hidden stage never
 * vanishes from the sheet while its switch is off. An Objektart with neither a geometry property nor a position at its
 * parent never has a place on the map, so it is not listed (v3 `FilterSheet.svelte:322`; a child at its parent is listed).
 */
import { localize } from '@ueberblick/ui';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { classifyingProperty, isServed, resolveMarker, type ResolvedMarker } from '@ueberblick/core';
import { inheritRelations, type FeatureType } from '@ueberblick/core/schema';
import type { Device } from '../../device';
import { ALL, type ChangeFeed } from '../../changed';

/**
 * How the map draws a feature of `type` whose classifying property holds `value` (WP-674, B-018): the value's look,
 * then the type's `marker`, else the core's one fallback (`DEFAULT_MARKER_COLOR`, v3 `map-icons.ts:57`). A look with an `icon` is drawn in place of the dot (v3
 * `FilterSheet.svelte:421-455`, `renderIcon`). The one place the sheets ask, so a row reads like its marker.
 */
export function lookOf(
  type: Pick<FeatureType, 'marker' | 'classify'>,
  value: string | undefined,
): ResolvedMarker {
  return resolveMarker(type, value);
}

export interface FilterValue {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly color: string;
  /** The value's look; with an `icon` the row draws it in place of the dot. */
  readonly look: ResolvedMarker;
}

export interface FilterCard {
  readonly type: Key;
  readonly label: string;
  readonly count: number;
  readonly color: string;
  /** The type's own look (its `marker`); with an `icon` the card draws it in place of the dot. */
  readonly look: ResolvedMarker;
  /** One row per value of the classifying property (the stage by default), in declaration order; empty when the type has none. */
  readonly values: readonly FilterValue[];
}

export interface FilterData {
  cards(): readonly FilterCard[];
  /** Rings when the features on the device may have changed. */
  subscribe(listener: () => void): () => void;
}

/** What one feature adds to the cards: its Objektart and, with a process, its stage. */
interface Counted {
  readonly type: Key;
  readonly stage: string | undefined;
}

/** Counts features per Objektart and stage; `remove` undoes `add`, so a change costs O(touched features) (WP-800). */
export class CardCounter {
  private readonly counts = new Map<Key, number>();
  private readonly stages = new Map<Key, Map<string, number>>();
  private readonly counted = new Map<FeatureId, Counted>();
  private readonly atParent: ReadonlySet<string>;
  constructor(private readonly types: CompiledConfig['file']['types']) {
    this.atParent = new Set(inheritRelations(types ?? {}).keys());
  }

  /** The type has a place on the map: a geometry of its own, or the position of its parent (`inherit_position`, B-019). */
  hasPlace(key: string, type: Pick<FeatureType, 'geometry'>): boolean {
    return type.geometry !== undefined || this.atParent.has(key);
  }

  private bump(c: Counted, by: 1 | -1): void {
    this.counts.set(c.type, (this.counts.get(c.type) ?? 0) + by);
    if (c.stage === undefined) return;
    const per = this.stages.get(c.type) ?? new Map<string, number>();
    per.set(c.stage, (per.get(c.stage) ?? 0) + by);
    this.stages.set(c.type, per);
  }

  /** Counts the feature (replacing what was counted for its id); a feature that is not served or has no place counts for nothing. */
  set(f: FeatureState | undefined): void {
    if (f === undefined) return;
    this.delete(f.id);
    const type = this.types?.[f.type];
    if (!isServed(f.lifecycle) || type === undefined || !this.hasPlace(f.type, type)) return;
    const property = classifyingProperty(type);
    const stage = property === undefined ? undefined : f.properties[property];
    const c: Counted = { type: f.type, stage: typeof stage === 'string' ? stage : undefined };
    this.counted.set(f.id, c);
    this.bump(c, 1);
  }

  delete(id: FeatureId): void {
    const c = this.counted.get(id);
    if (c === undefined) return;
    this.counted.delete(id);
    this.bump(c, -1);
  }

  countOf(type: Key): number | undefined {
    const n = this.counts.get(type);
    return n === undefined || n <= 0 ? undefined : n;
  }

  stageCount(type: Key, value: string): number {
    return this.stages.get(type)?.get(value) ?? 0;
  }
}

function cardsOf(config: CompiledConfig, locale: string, counter: CardCounter): readonly FilterCard[] {
  const cards: FilterCard[] = [];
  for (const [key, type] of Object.entries(config.file.types ?? {})) {
    const count = counter.countOf(key as Key);
    if (count === undefined || !counter.hasPlace(key, type)) continue;
    const property = classifyingProperty(type);
    const options = property === undefined ? undefined : type.properties[property]?.options;
    const own = lookOf(type, undefined);
    cards.push({
      type: key as Key,
      label: localize(type.label, locale),
      count,
      color: own.color,
      look: own,
      values: Object.keys(options ?? {}).map((value) => {
        const look = lookOf(type, value);
        return {
          value,
          label: localize(options?.[value] ?? value, locale),
          count: counter.stageCount(key as Key, value),
          color: look.color,
          look,
        };
      }),
    });
  }
  return cards;
}

export function buildCards(
  config: CompiledConfig,
  locale: string,
  features: Iterable<FeatureState>,
): readonly FilterCard[] {
  const counter = new CardCounter(config.file.types);
  for (const f of features) counter.set(f);
  return cardsOf(config, locale, counter);
}

/**
 * The cards of one view, from the device. Seam: it reads the view's rows (what the map shows) and looks each up on
 * the device; one pass over the view's features per change burst, never per interaction. A counter inside the store
 * can replace it without touching the sheet.
 */
export function deviceFilterData(
  device: Pick<Device, 'classified' | 'viewList' | 'feature'>,
  viewKey: string,
  locale: string,
  changed: Pick<ChangeFeed, 'subscribe'>,
): FilterData {
  let counter: CardCounter | undefined; // undefined: count everything again
  let pending = new Set<FeatureId>();
  return {
    cards() {
      const list = device.viewList(viewKey);
      if (counter === undefined) {
        counter = new CardCounter(device.classified.file.types);
        for (const row of list.rows()) counter.set(device.feature(row.id));
      } else if (pending.size > 0) {
        const inView = new Set(list.rowsOf(pending).map((r) => r.id));
        for (const id of pending) {
          if (inView.has(id)) counter.set(device.feature(id));
          else counter.delete(id);
        }
      }
      pending = new Set();
      return cardsOf(device.classified, locale, counter);
    },
    // A burst that names its features recounts only those; one that names none (a queue change that moved nothing)
    // rings nothing; anything else recounts all.
    subscribe: (listener) =>
      changed.subscribe((c) => {
        if (c === ALL) counter = undefined;
        else if (c.size === 0) return;
        else for (const id of c) pending.add(id);
        listener();
      }),
  };
}
