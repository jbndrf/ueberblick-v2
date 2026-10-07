// The Aktivität timeline of a feature as v3 drew it (activity-sections.ts `buildDocumentActivitySegments`): runs grouped
// by stage visit, a creation header, one smart label per run. Pure: the reader hands the runs (`input.activity`, newest
// first, own pending and refused ones on top); this only groups, classifies and formats. The words are the app's.
import type { Instant, Json, Key, Property, RunId } from '@ueberblick/core/model';
import type { ActivityStatus } from '@ueberblick/core/registry';
import type { GalleryFile } from '../form/gallery/files';
import type { ActivityChange, ActivityEntry, FeatureSheetInput, PropertyLink } from './contract';
import { formatProperty, propertyLabel, type FormatContext } from './format';

/** What a run did, in one line (v3 `docEntryLabel`); the app turns it into words. */
export type ActivityLabel =
  | { readonly kind: 'created' }
  | { readonly kind: 'task' }
  | { readonly kind: 'location' }
  | { readonly kind: 'field'; readonly label: string }
  | { readonly kind: 'fields'; readonly count: number };

/** One changed value of a run. */
export interface ActivityField {
  readonly key: Key;
  readonly label: string;
  readonly text: string;
  readonly empty: boolean;
  readonly files: readonly GalleryFile[];
  readonly links: readonly PropertyLink[];
}

export interface ActivityRun {
  readonly runId: RunId;
  readonly task: string;
  readonly actorLabel: string;
  readonly at: Instant;
  readonly status: ActivityStatus;
  readonly label: ActivityLabel;
  readonly fields: readonly ActivityField[];
  readonly touchedGeometry: boolean;
}

export interface ActivitySegment {
  /** Unique within the timeline. */
  readonly key: string;
  /** The stage of the visit; absent for a type without a process. */
  readonly stageKey?: string;
  readonly stageLabel?: string;
  readonly visitIndex: number;
  readonly visitTotal: number;
  /** The first segment: the stage the feature started in (no move into it). */
  readonly initial: boolean;
  /** The run that moved the feature into this stage. */
  readonly transition?: {
    readonly at: Instant;
    readonly by: string;
    readonly status: ActivityStatus;
  };
  /** The creating run (initial segment only). */
  readonly creation?: ActivityRun;
  /** Creation time and creator (absent: not known here) from the feature's audit fields, when the creating run is not on the device. */
  readonly created?: { readonly at: Instant; readonly by: string | undefined };
  /** Newest first. */
  readonly entries: readonly ActivityRun[];
}

export interface ActivityView {
  /** Newest first. Empty: "Noch keine Aktivität". */
  readonly segments: readonly ActivitySegment[];
}

const TYPE_KEY = '$type';

interface Classified {
  readonly entry: ActivityEntry;
  /** The stage the run ends in (its last stage write, v3 `last non-empty wins`). */
  readonly target: string | undefined;
  /** The stage the run wrote first: for the creating run the stage it started in. */
  readonly first: string | undefined;
  readonly fields: readonly ActivityField[];
  readonly touchedGeometry: boolean;
  readonly creating: boolean;
}

export function buildActivity(input: FeatureSheetInput): ActivityView {
  const { type, locale, feature } = input;
  const visible = new Set<string>(input.properties ?? Object.keys(type.properties));
  const stageKey = type.process?.property;
  const context = (key: Key): FormatContext => ({
    locale,
    ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
    lookups: input.lookups,
    derived: feature.derived,
    key,
  });
  const show = (key: Key, value: Json): Omit<ActivityField, 'key' | 'label'> => {
    const shown = formatProperty(value, type.properties[key] as Property, context(key));
    return {
      text: shown?.text ?? '',
      empty: shown === undefined,
      files: shown?.files ?? [],
      links: shown?.links ?? [],
    };
  };
  const stageName = (value: string): string => {
    const property = stageKey === undefined ? undefined : type.properties[stageKey];
    return property === undefined || stageKey === undefined
      ? value
      : (formatProperty(value, property, context(stageKey as Key))?.text ?? value);
  };

  const classify = (entry: ActivityEntry): Classified => {
    let target: string | undefined;
    let first: string | undefined;
    let touchedGeometry = false;
    let creating = false;
    const byProperty = new Map<Key, ActivityChange>();
    for (const change of entry.changes) {
      if (change.property === TYPE_KEY) creating = true;
      const property = type.properties[change.property];
      if (property === undefined || !visible.has(change.property)) continue;
      if (change.property === stageKey) {
        if (typeof change.result === 'string' && change.result !== '') {
          target = change.result;
          first ??= change.result;
        }
      } else if (property.type === 'geometry') touchedGeometry = true;
      else byProperty.set(change.property, change);
    }
    const fields = [...byProperty.values()].map((c) => ({
      key: c.property,
      label: propertyLabel(type, c.property, locale),
      ...show(c.property, c.result),
    }));
    return { entry, target, first, fields, touchedGeometry, creating };
  };

  const toRun = (c: Classified, isCreation: boolean): ActivityRun => {
    const count = c.fields.length + (c.touchedGeometry ? 1 : 0);
    const only = c.fields[0];
    const label: ActivityLabel = isCreation
      ? { kind: 'created' }
      : count === 0
        ? { kind: 'task' }
        : count > 1
          ? { kind: 'fields', count }
          : only === undefined
            ? { kind: 'location' }
            : { kind: 'field', label: only.label };
    return {
      runId: c.entry.runId,
      task: c.entry.task,
      actorLabel: c.entry.actorLabel,
      at: c.entry.at,
      status: c.entry.status,
      label,
      fields: c.fields,
      touchedGeometry: c.touchedGeometry,
    };
  };

  interface Open {
    stageKey: string | undefined;
    initial: boolean;
    transition?: ActivitySegment['transition'];
    creation?: ActivityRun;
    created?: ActivitySegment['created'];
    entries: ActivityRun[];
  }
  // Oldest first, as v3 walked the log.
  const ascending = [...input.activity].reverse().map(classify);
  // The creating run is known by its `$type` write, else (the device never receives `$` observations) as the run made at
  // the creation time of the feature's audit fields (WP-726): its first stage write is the start, not a move into it.
  const createdMs = feature.createdAt === undefined ? Number.NaN : Date.parse(feature.createdAt);
  const creation =
    ascending.find((c) => c.creating) ?? ascending.find((c) => Date.parse(c.entry.at) === createdMs);
  const initialStage = creation?.first ?? type.process?.start;
  const open: Open[] = [{ stageKey: initialStage, initial: true, entries: [] }];
  for (const c of ascending) {
    const last = open[open.length - 1] as Open;
    if (c === creation) {
      last.creation = toRun(c, true);
      // v3: a later stage write of the creating run (`then: set`) is a move out of the start stage.
      if (c.target !== undefined && c.target !== c.first) {
        open.push({
          stageKey: c.target,
          initial: false,
          transition: { at: c.entry.at, by: c.entry.actorLabel, status: c.entry.status },
          entries: [],
        });
      }
    } else if (c.target !== undefined) {
      open.push({
        stageKey: c.target,
        initial: false,
        transition: { at: c.entry.at, by: c.entry.actorLabel, status: c.entry.status },
        entries: c.fields.length > 0 || c.touchedGeometry ? [toRun(c, false)] : [],
      });
    } else last.entries.push(toRun(c, false));
  }
  const first = open[0] as Open;
  if (first.creation === undefined && feature.createdAt !== undefined) {
    const by = feature.createdBy;
    first.created = {
      at: feature.createdAt,
      by: by === undefined ? undefined : input.lookups.participant(by),
    };
  }
  const withCreated = open;

  // v3: an empty initial segment is dropped unless it is the only one (and here also not when it holds "Erstellt").
  const kept = withCreated.filter(
    (s) =>
      !s.initial ||
      s.entries.length > 0 ||
      s.creation !== undefined ||
      s.created !== undefined ||
      withCreated.length === 1,
  );
  const hasRuns = input.activity.length > 0 || first.created !== undefined;
  if (!hasRuns) return { segments: [] };

  const totals = new Map<string | undefined, number>();
  for (const s of kept) totals.set(s.stageKey, (totals.get(s.stageKey) ?? 0) + 1);
  const seen = new Map<string | undefined, number>();
  const segments = kept.map((s, i): ActivitySegment => {
    const index = (seen.get(s.stageKey) ?? 0) + 1;
    seen.set(s.stageKey, index);
    return {
      key: `${i}:${s.stageKey ?? ''}`,
      ...(s.stageKey === undefined ? {} : { stageKey: s.stageKey, stageLabel: stageName(s.stageKey) }),
      visitIndex: index,
      visitTotal: totals.get(s.stageKey) ?? 1,
      initial: s.initial,
      ...(s.transition === undefined ? {} : { transition: s.transition }),
      ...(s.creation === undefined ? {} : { creation: s.creation }),
      ...(s.created === undefined ? {} : { created: s.created }),
      entries: [...s.entries].reverse(),
    };
  });
  return { segments: segments.reverse() };
}
