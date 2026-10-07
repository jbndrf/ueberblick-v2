/**
 * What the view builder needs of the device (WP-665): the offered fields and stages, the two directions between rows
 * and a saved view (core `filterToClauses` / `clausesToFilter`), and the creators by name. A port, so the builder runs
 * the same over the device, a fixture or (H4) an assistant's view.
 */
import {
  builderContext,
  clausesToFilter,
  creatorIds,
  filterToClauses,
  type BuilderContext,
  type Clause,
  type FilterSource,
} from '@ueberblick/core/filters';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { labelPeople, participantName } from '../../../people';
import type { Actor, FeatureState, Key } from '@ueberblick/core/model';
import type { Device } from '../../../device';

export interface CreatorOption {
  readonly id: string;
  readonly label: string;
}

export interface BuilderPort {
  readonly context: BuilderContext;
  read(filters: FilterSource): readonly Clause[];
  write(clauses: readonly Clause[]): FilterSource;
  /** The people who created Objekte on this device, by name. Computed on first use and kept. */
  creators(): readonly CreatorOption[];
}

export interface BuilderSources {
  readonly config: CompiledConfig;
  readonly actor: Actor;
  readonly locale: string;
  /** The Objekte of these Objektarten on the device. */
  readonly features: (types: readonly string[]) => Iterable<FeatureState>;
  /** The name the sync shipped for an actor id, if any. */
  readonly nameOf: (id: string) => string | undefined;
  /** What stands for a person whose name the device does not know (v3 `activity_unknown_actor`). */
  readonly unknown: string;
}

export function builderPort(src: BuilderSources): BuilderPort {
  const context = builderContext(src.config, src.actor, src.locale);
  const stageOf = (type: string): string | undefined => context.stages.find((s) => s.type === type)?.property;
  let creators: readonly CreatorOption[] | undefined;
  return {
    context,
    read: (filters) => filterToClauses(src.config, filters, context.types),
    write: (clauses) => clausesToFilter(clauses, context.types, stageOf),
    creators() {
      if (creators !== undefined) return creators;
      const named = creatorIds(src.features(context.types)).map((id) => ({ id, name: src.nameOf(id) }));
      // A name the device does not know is not shown as an id (v3 did): "Jemand", numbered so people stay apart.
      creators = labelPeople(named, src.unknown).sort((a, b) => a.label.localeCompare(b.label, src.locale));
      return creators;
    },
  };
}

/** The port over the device: features from the store, names from the people the sync shipped, the own name for the own id. */
export function devicePort(device: Device, locale: string, unknown: string): BuilderPort {
  return builderPort({
    config: device.config,
    actor: device.actor,
    locale,
    features: function* (types) {
      for (const t of types)
        for (const id of device.store.featureIdsOfType(t as Key)) {
          const f = device.feature(id);
          if (f !== undefined) yield f;
        }
    },
    nameOf: (id) =>
      participantName(
        {
          selfId: device.actor.id,
          selfName: device.participant.name,
          personName: (who) => device.store.personName(who),
        },
        id,
      ),
    unknown,
  });
}
