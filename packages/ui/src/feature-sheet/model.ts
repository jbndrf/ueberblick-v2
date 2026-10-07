// Builds the feature sheet model. Pure; touches the feature once per property and once per edge.
import { displayName } from '@ueberblick/core/locale';
import type { Edge, FeatureId, Key, Property } from '@ueberblick/core/model';
import { m } from '../paraglide/messages.js';
import { localize } from '../form/localize';
import {
  HISTORY_CAP,
  type FeatureSheetInput,
  type FeatureSheetModel,
  type HistoryRow,
  type PropertyRow,
  type RelationGroup,
  type RelationItem,
} from './contract';
import { formatProperty, messageLocale, propertyLabel, type FormatContext } from './format';

function buildRows(input: FeatureSheetInput, keys: readonly Key[]): PropertyRow[] {
  const { feature, type, locale } = input;
  const lm = { locale: messageLocale(locale) };
  return keys.map((key) => {
    const property = type.properties[key] as Property;
    const ctx: FormatContext = {
      locale,
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
      lookups: input.lookups,
      derived: feature.derived,
      key,
    };
    const shown = formatProperty(feature.properties[key], property, ctx);
    // An empty or whitespace-only text with nothing else to show reads like a missing value.
    const empty =
      shown === undefined ||
      (shown.text.trim() === '' && !shown.files?.length && !shown.links?.length && !shown.badges?.length);
    return {
      key,
      label: propertyLabel(type, key, locale),
      kind: property.type,
      badges: shown?.badges ?? [],
      multiline: property.type === 'text' && /[\r\n]/.test(shown?.text ?? ''),
      text: empty ? m.ui_feature_sheet_no_value({}, lm) : (shown?.text ?? ''),
      empty,
      files: shown?.files ?? [],
      links: shown?.links ?? [],
    };
  });
}

/**
 * A relation has no label of its own in the schema yet, so the sheet names it by the picked property
 * of the same key, else by the feature type on the other side, else by its key.
 */
function relationLabel(input: FeatureSheetInput, edge: Edge, incoming: boolean): string {
  const otherType = incoming
    ? input.lookups.feature(edge.from)?.type
    : input.type.relations?.[edge.relation]?.to;
  const declared = incoming ? undefined : input.type.properties[edge.relation]?.label;
  const fallback = otherType === undefined ? undefined : input.types[otherType]?.label;
  const named = declared ?? fallback;
  const label = named === undefined ? edge.relation : localize(named, input.locale);
  return incoming ? m.ui_feature_sheet_incoming({ label }, { locale: messageLocale(input.locale) }) : label;
}

function buildRelations(input: FeatureSheetInput): RelationGroup[] {
  const groups = new Map<string, { label: string; incoming: boolean; items: RelationItem[] }>();
  const add = (edge: Edge, incoming: boolean): void => {
    const id = `${incoming ? 'in' : 'out'}:${edge.relation}`;
    const otherId: FeatureId = incoming ? edge.from : edge.to;
    let group = groups.get(id);
    if (group === undefined) {
      group = { label: relationLabel(input, edge, incoming), incoming, items: [] };
      groups.set(id, group);
    }
    group.items.push({
      id: otherId,
      label: input.lookups.feature(otherId)?.label ?? otherId,
      derived: edge.derived,
    });
  };
  for (const e of input.edgesOut) add(e, false);
  for (const e of input.edgesIn) add(e, true);
  const collator = new Intl.Collator(input.locale);
  return [...groups].map(([id, g]) => ({
    id,
    label: g.label,
    incoming: g.incoming,
    items: g.items.sort((a, b) => collator.compare(a.label, b.label)),
  }));
}

/** One row per changed value, in the order of the entries (the reader sorts them newest first). */
function buildHistory(input: FeatureSheetInput, visible: ReadonlySet<Key>): HistoryRow[] {
  const perProperty = new Map<Key, number>();
  const rows: HistoryRow[] = [];
  for (const entry of input.activity) {
    for (const change of entry.changes) {
      if (!visible.has(change.property)) continue;
      const seen = perProperty.get(change.property) ?? 0;
      if (seen >= HISTORY_CAP) continue;
      perProperty.set(change.property, seen + 1);
      const property = input.type.properties[change.property] as Property;
      const ctx: FormatContext = {
        locale: input.locale,
        timeZone: input.timeZone,
        lookups: input.lookups,
        derived: input.feature.derived,
        key: change.property,
      };
      rows.push({
        key: `${entry.runId}:${change.property}`,
        property: change.property,
        cleared: change.result === null || change.result === '',
        who: entry.actorLabel,
        what: propertyLabel(input.type, change.property, input.locale),
        value: formatProperty(change.result, property, ctx)?.text ?? '',
        at: entry.at,
      });
    }
  }
  return rows;
}

export function buildFeatureSheetModel(input: FeatureSheetInput): FeatureSheetModel {
  const { type, locale } = input;
  const keys = (input.properties ?? (Object.keys(type.properties) as Key[])).filter(
    (key) => type.properties[key] !== undefined,
  );
  return {
    id: input.feature.id,
    title: displayName(type, input.feature, [locale]),
    typeLabel: localize(type.label, locale),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    rows: buildRows(input, keys),
    tasks: input.availableTasks.map((key) => {
      const label = input.taskLabels[key];
      return { key, label: label === undefined ? key : localize(label, locale) };
    }),
    relations: buildRelations(input),
    history: buildHistory(input, new Set(keys)),
    locale,
  };
}
