/**
 * The columns of the Liste (v3 shows a view's fields as columns, `ff.label ?? shortLabel(ff.id)`, map/+page.svelte:1446):
 * the header is the property's label in the app language, its key only when the template gave none. A cell reads as the
 * Daten row of the sheet does, through the same `formatProperty` (R1): an option's label, a date and a number in the
 * language the person chose.
 */
import type { FeatureId, Key, Property, TemplateFile } from '@ueberblick/core/model';
import { formatProperty, resolveLabel, type FormatContext, type ListColumn } from '@ueberblick/ui';
import type { Device } from '../device';
import { participantName } from '../people';

const COLUMNS_WITHOUT_PROPERTIES = 3;

/** The lookups a cell may need: the display label of a referenced Objekt. */
export type ListLookup = Pick<FormatContext['lookups'], 'feature' | 'participant'>;

export function deviceListLookup(
  device: Pick<Device, 'feature' | 'reader' | 'participant' | 'store'>,
  locale?: string,
): ListLookup {
  return {
    // The one name lookup of the sheet's Daten (`participantName`, R1): the own name, else the sync page's `people`.
    participant: (id) =>
      participantName(
        {
          selfId: device.participant.id,
          selfName: device.participant.name,
          personName: (who) => device.store.personName(who),
        },
        id,
      ),
    feature: (id: FeatureId) => {
      const state = device.feature(id);
      return state === undefined
        ? undefined
        : { label: device.reader.labelOf(state, locale), type: state.type };
    },
  };
}

export function listColumns(
  file: TemplateFile,
  view:
    | { readonly source: { readonly type: string }; readonly properties?: readonly string[] | undefined }
    | undefined,
  locale: string,
  lookup: ListLookup,
): ListColumn[] {
  const type = view === undefined ? undefined : file.types?.[view.source.type];
  if (view === undefined || type === undefined) return [];
  const keys =
    view.properties ??
    Object.entries(type.properties)
      .filter(([, p]) => p.type !== 'geometry' && p.type !== 'file')
      .map(([k]) => k)
      .slice(0, COLUMNS_WITHOUT_PROPERTIES);
  return keys.map((key) => {
    const property = type.properties[key] as Property | undefined;
    return {
      key,
      label: resolveLabel(property?.label, locale, key),
      format: (value) => {
        if (property === undefined) return value === undefined || value === null ? '' : String(value);
        const ctx: FormatContext = {
          locale,
          lookups: lookup,
          derived: {},
          key: key as Key,
        };
        return formatProperty(value, property, ctx)?.text ?? '';
      },
    };
  });
}
