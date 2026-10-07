/**
 * The Felder hub as data (v3 `FieldHub.svelte`): the Daten layout of one Objektart. Tabs are the distinct
 * `properties.<p>.display.tab` names (the default tab "Daten" first, then `tab_order`, then by name), a tab holds
 * lines of cells (same `display.row` shares a line; `left < right < full`), hidden properties form the library
 * ("Ausgeblendet"). The ordering is core's `layoutTabs`, the participant Daten view's too, so what the admin
 * lays out here is what the reader sees. The geometry property is not a Daten field in v3 either (a system def).
 * Pure: no DOM, no I/O.
 */
import { DEFAULT_TAB, layoutTabs } from '@ueberblick/core';
import type {
  LocalizedString,
  Property,
  PropertyDisplayColumn,
  PropertyTypeKey,
  TemplateFile,
} from '@ueberblick/core';
import { labelOf } from '../../../shell/location';
import { usedIn, type UsedIn } from './used-in';

/** The default tab has no name; the view calls it "Daten" (v3 `DEFAULT_DATA_TAB = ''`). */
export const HUB_DEFAULT_TAB = DEFAULT_TAB;

/** v3's write modes (`modelWriteMode*`), read from what v4 knows: a computed property, a measurement series, the rest. */
export const WRITE_MODES = { single: 'single', observation: 'observation', computed: 'computed' } as const;
export type WriteMode = (typeof WRITE_MODES)[keyof typeof WRITE_MODES];

export interface HubField {
  readonly key: string;
  readonly label: string;
  readonly type: PropertyTypeKey;
  readonly required: boolean;
  readonly writeMode: WriteMode;
  readonly hidden: boolean;
  readonly column: PropertyDisplayColumn;
  /** The row it sits in (absent: follows in type order). */
  readonly row?: number;
  readonly usedIn: UsedIn;
}

export interface HubTab {
  /** `HUB_DEFAULT_TAB` or the tab name in the builder's language. */
  readonly name: string;
  readonly isDefault: boolean;
  /** The visible fields as lines of cells, in Daten order. */
  readonly lines: readonly (readonly HubField[])[];
}

export interface FieldHubModel {
  /** The default tab is always there (v3 `isDefault`), the others only while they hold a visible field. */
  readonly tabs: readonly HubTab[];
  /** The library: every hidden field. */
  readonly hidden: readonly HubField[];
  /** Every field of the Objektart in type order (for the search). */
  readonly all: readonly HubField[];
}

export const tabNameOf = (p: Property, locale: string): string =>
  p.display?.tab === undefined ? HUB_DEFAULT_TAB : labelOf(p.display.tab as LocalizedString, locale, '');

function writeModeOf(p: Property): WriteMode {
  if (p.computed !== undefined) return WRITE_MODES.computed;
  return p.display?.history === 'measurements' ? WRITE_MODES.observation : WRITE_MODES.single;
}

export function buildFieldHub(file: TemplateFile, type: string, locale: string): FieldHubModel {
  const featureType = file.types?.[type];
  const entries = Object.entries(featureType?.properties ?? {}).filter(([k]) => k !== featureType?.geometry);
  const all = entries.map(
    ([key, p]): { readonly field: HubField; readonly display: Property['display'] } => ({
      display: p.display,
      field: {
        key,
        label: labelOf(p.label as LocalizedString | undefined, locale, key),
        type: p.type,
        required: p.required === true,
        writeMode: writeModeOf(p),
        hidden: p.display?.hidden === true,
        column: p.display?.column ?? 'full',
        ...(p.display?.row === undefined ? {} : { row: p.display.row }),
        usedIn: usedIn(file, type, key),
      },
    }),
  );
  // the ordering is core's, the one the reader's Daten view uses (R1); the default tab is always offered here
  const tabs = layoutTabs(
    all.map((f) => ({ value: f.field, display: f.display })),
    { locale, keepDefaultTab: true },
  ).map((tab): HubTab => ({
    name: tab.name,
    isDefault: tab.name === HUB_DEFAULT_TAB,
    lines: tab.lines.map((line) => line.map((c) => c.value)),
  }));
  return {
    tabs,
    hidden: all.filter((f) => f.field.hidden).map((f) => f.field),
    all: all.map((f) => f.field),
  };
}

/** The fields whose label, key or type label contains `query` (case-insensitive); all of them for an empty query. */
export function searchFields(
  fields: readonly HubField[],
  query: string,
  typeLabel: (type: PropertyTypeKey) => string,
): readonly HubField[] {
  const q = query.trim().toLowerCase();
  if (q === '') return fields;
  return fields.filter(
    (f) =>
      f.label.toLowerCase().includes(q) ||
      f.key.toLowerCase().includes(q) ||
      typeLabel(f.type).toLowerCase().includes(q),
  );
}
