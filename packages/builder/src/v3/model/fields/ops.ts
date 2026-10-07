/**
 * What the Felder hub writes, as document ops (WP-378; v3 `FieldHub.svelte` `hide`, `showOnTab`, `dropOn*`,
 * `addField`). The layout of a property is its `display` (WP-659), always written as the whole object so one overlay
 * entry per property stays valid. Pure functions of the effective file: the hub, tests and assistants (H4) share them (R1).
 */
import {
  formatKeyPath,
  type KeyPath,
  type LocalizedString,
  type Property,
  type PropertyDisplayColumn,
  type TemplateFile,
} from '@ueberblick/core';
import type { Op } from '../../../doc';
import { slugKey } from '../../../lenses/data-model/ops';
import { labelOf } from '../../../shell/location';
import { HUB_DEFAULT_TAB, tabNameOf } from './hub';

const propertyPath = (type: string, key: string): KeyPath =>
  formatKeyPath(['types', type, 'properties', key]);
const propertiesOf = (file: TemplateFile, type: string): Readonly<Record<string, Property>> =>
  file.types?.[type]?.properties ?? {};

/** The `display` after `patch`; a key set to `undefined` is removed. */
function patched(
  current: object | undefined,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged = { ...current, ...patch } as Record<string, unknown>;
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
}

export function displayOp(
  file: TemplateFile,
  type: string,
  key: string,
  patch: Readonly<Record<string, unknown>>,
): Op {
  const display = patched(propertiesOf(file, type)[key]?.display, patch);
  return { kind: 'set', path: `${propertyPath(type, key)}.display` as KeyPath, value: display };
}

/** "Aus Daten-Tabs ausblenden": the property goes to the library. */
export const hideOp = (file: TemplateFile, type: string, key: string): Op =>
  displayOp(file, type, key, { hidden: true });

/** The next free row of a tab (v3 counted the fields of the tab, but this never collides with a numbered row). */
export function nextRow(file: TemplateFile, type: string, tab: string, locale: string): number {
  const rows = Object.values(propertiesOf(file, type))
    .filter((p) => p.display?.hidden !== true && tabNameOf(p, locale) === tab)
    .map((p) => p.display?.row)
    .filter((r): r is number => r !== undefined);
  return rows.length === 0 ? 0 : Math.max(...rows) + 1;
}

/** The `tab` value for a tab name: an existing property's own localized name, or one new in the builder's language. */
function tabValue(
  file: TemplateFile,
  type: string,
  tab: string,
  locale: string,
): LocalizedString | undefined {
  if (tab === HUB_DEFAULT_TAB) return undefined;
  const same = Object.values(propertiesOf(file, type)).find((p) => tabNameOf(p, locale) === tab);
  return same?.display?.tab ?? { [locale]: tab };
}

export interface Place {
  readonly tab: string;
  readonly row: number;
  readonly column: PropertyDisplayColumn;
}

/** v3 moved a field to a tab, row and column: the property shows in `place` (and is no longer hidden). */
export function moveOp(file: TemplateFile, type: string, key: string, place: Place, locale: string): Op {
  return displayOp(file, type, key, {
    hidden: undefined,
    tab: tabValue(file, type, place.tab, locale),
    row: place.row,
    column: place.column === 'full' ? undefined : place.column,
  });
}

/** "Auf Daten-Tab anzeigen": from the library to the default tab, as a new last row (v3 `showOnTab`). */
export const showOp = (file: TemplateFile, type: string, key: string, locale: string): Op =>
  moveOp(
    file,
    type,
    key,
    { tab: HUB_DEFAULT_TAB, row: nextRow(file, type, HUB_DEFAULT_TAB, locale), column: 'full' },
    locale,
  );

/**
 * v3 `dropOnCard`: `key` goes next to `target` (left or right half), in the target's tab and row. A full-width
 * target takes the other half, so the pair really shares the line (v3 left it full, which drew them apart).
 */
export function dropOnCardOps(
  file: TemplateFile,
  type: string,
  key: string,
  target: string,
  column: 'left' | 'right',
  locale: string,
): Op[] {
  const t = propertiesOf(file, type)[target];
  if (t === undefined || key === target) return [];
  const tab = tabNameOf(t, locale);
  const row = t.display?.row ?? nextRow(file, type, tab, locale);
  const ops = [moveOp(file, type, key, { tab, row, column }, locale)];
  if (t.display?.row === undefined || (t.display.column ?? 'full') === 'full') {
    ops.push(
      displayOp(file, type, target, {
        row,
        column: column === 'left' ? 'right' : 'left',
      }),
    );
  }
  return ops;
}

/** v3 `dropOnTab` / `dropOnBody`: the property becomes a new last row of the tab. */
export const dropOnTabOp = (file: TemplateFile, type: string, key: string, tab: string, locale: string): Op =>
  moveOp(file, type, key, { tab, row: nextRow(file, type, tab, locale), column: 'full' }, locale);

export interface NewField {
  readonly op: Op;
  readonly key: string;
}

/** v3 `addField`: a text field starts in the library (hidden), its label unique among the type's ("Neues Feld 2"). */
export function addFieldOp(file: TemplateFile, type: string, name: string, locale: string): NewField {
  const props = propertiesOf(file, type);
  const labels = new Set(
    Object.entries(props).map(([k, p]) => labelOf(p.label as LocalizedString | undefined, locale, k)),
  );
  let label = name;
  for (let n = 2; labels.has(label); n += 1) label = `${name} ${n}`;
  const key = slugKey(label, new Set(Object.keys(props)));
  const value = { type: 'text', label: { [locale]: label }, display: { hidden: true } };
  return { key, op: { kind: 'add', path: propertyPath(type, key), value } };
}
