// The feature sheet contract (WP-525). The model is pure data built from a folded feature; the
// component only draws it. Permissions decide `availableTasks` and what may be seen; the sheet
// has no permission logic.
import type { ActivityStatus } from '@ueberblick/core/registry';
import type {
  Edge,
  FeatureId,
  FeatureType,
  FoldedFeature,
  Instant,
  Json,
  Key,
  LocalizedString,
  PropertyTypeKey,
  RunId,
} from '@ueberblick/core/model';
import type { GalleryFile } from '../form/gallery/files';

/** History entries kept per property (docs/ia-map.md: "recent history"). */
export const HISTORY_CAP = 10;

/** Names for ids the sheet is only given as values. `undefined` means not known on this device. */
export interface FeatureSheetLookups {
  participant(id: string): string | undefined;
  /** The label of a role key (a `role` property); absent or `undefined`: the key is shown. */
  role?(key: string): string | undefined;
  feature(id: FeatureId): { readonly label: string; readonly type: Key } | undefined;
}

/** One value a run set on the feature. */
export interface ActivityChange {
  readonly property: Key;
  readonly result: Json;
}

/**
 * One run on the feature, as v3 showed it: the task, who did it, when, the values it changed and
 * where it stands for this device. The reader builds the list (newest first); the sheet only draws it.
 */
export interface ActivityEntry {
  readonly runId: RunId;
  /** The task's label, ready to show. */
  readonly task: string;
  /** The actor's name, or the neutral label when the role may not see names. */
  readonly actorLabel: string;
  readonly at: Instant;
  readonly status: ActivityStatus;
  readonly changes: readonly ActivityChange[];
}

export interface FeatureSheetInput {
  readonly feature: FoldedFeature;
  /** The feature type of `feature.type`, from the effective file. */
  readonly type: FeatureType;
  /** All feature types by key: incoming edges are labelled by the type they come from. */
  readonly types: Readonly<Record<string, FeatureType>>;
  /** Decided by perms, not by the sheet. Order is kept. */
  readonly availableTasks: readonly Key[];
  readonly taskLabels: Readonly<Record<string, LocalizedString>>;
  readonly edgesOut: readonly Edge[];
  readonly edgesIn: readonly Edge[];
  /** Newest first. */
  readonly activity: readonly ActivityEntry[];
  /** H3: which properties show, in this order (a data view's `properties`). Absent: all of the type. */
  readonly properties?: readonly Key[];
  readonly lookups: FeatureSheetLookups;
  readonly locale: string;
  /** When the feature last changed, for "main value - 2 h ago" in the header. Absent while the device lacks it. */
  readonly updatedAt?: Instant;
  /** IANA zone for dates; the device zone when absent. */
  readonly timeZone?: string;
}

export interface PropertyLink {
  readonly id: FeatureId;
  readonly label: string;
}

export interface PropertyRow {
  readonly key: Key;
  readonly label: string;
  /** The property type, which picks the box the Daten view draws. */
  readonly kind: PropertyTypeKey;
  /** `select`/`multiselect`: the chosen options' labels in the order the property declares them (v3: option order). */
  readonly badges: readonly string[];
  /** `text` with a line break: the long-text box (v3: `long_text`). */
  readonly multiline: boolean;
  /** Readable value; for a `file` the count as text, the slot draws the thumbnails. */
  readonly text: string;
  readonly empty: boolean;
  /** `file`: the entries the gallery draws. */
  readonly files: readonly GalleryFile[];
  /** `reference`: the features to open. */
  readonly links: readonly PropertyLink[];
}

export interface RelationItem {
  readonly id: FeatureId;
  readonly label: string;
  /** Computed by a rule (`derived`), as opposed to picked. */
  readonly derived: boolean;
}

export interface RelationGroup {
  /** Unique per relation and direction. */
  readonly id: string;
  readonly label: string;
  readonly incoming: boolean;
  readonly items: readonly RelationItem[];
}

export interface TaskChoice {
  readonly key: Key;
  readonly label: string;
  /** The admin's button colour (CSS colour); absent: the default button. */
  readonly color?: string;
}

export interface HistoryRow {
  readonly key: string;
  /** The property the value belongs to, for the count and the dialog of that property in Daten. */
  readonly property: Key;
  /** The value was cleared (v3: "Geleert"). */
  readonly cleared: boolean;
  readonly who: string;
  readonly what: string;
  readonly value: string;
  readonly at: Instant;
}

export interface FeatureSheetModel {
  readonly id: FeatureId;
  /** The display name of the feature (main value). */
  readonly title: string;
  /** The feature type's label, the sheet's heading. */
  readonly typeLabel: string;
  readonly updatedAt?: Instant;
  readonly rows: readonly PropertyRow[];
  readonly tasks: readonly TaskChoice[];
  readonly relations: readonly RelationGroup[];
  /** Newest first, at most `HISTORY_CAP` per property. */
  readonly history: readonly HistoryRow[];
  readonly locale: string;
}
