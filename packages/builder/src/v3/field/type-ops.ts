/**
 * The type-specific settings of a property in the Felddefinition (v3 `FieldConfigPanel` def block): the limits of a
 * number (`min`, `max`), the allowed file types and the maximum number of files (`accept`, `max_files`, owner Q7),
 * and the date mode (the property type `date`, `datetime` or `time`, owner Q8, written by `changeTypeOp`). Pure
 * builders of WP-200 ops: the pane, the tests and an assistant (H4) share them (R1).
 */
import { formatKeyPath, type Property } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps, setOps } from '../../lenses/task/edit';

/** v3 "Datumsmodus": the three property types that hold a date or a time (Q8). */
export const DATE_MODES = ['date', 'datetime', 'time'] as const;

/** v3 "Erlaubte Dateitypen": all, images, documents. `custom` is any other list, kept as it is. */
export const FILE_PRESETS = ['all', 'images', 'documents'] as const;
export type FilePreset = (typeof FILE_PRESETS)[number];

const ACCEPT: Readonly<Record<Exclude<FilePreset, 'all'>, readonly string[]>> = {
  images: ['image/*'],
  documents: ['.pdf', '.doc', '.docx', '.txt'],
};

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Which preset an `accept` list is; `custom` for another list. */
export function filePresetOf(prop: Pick<Property, 'accept'>): FilePreset | 'custom' {
  const accept = prop.accept;
  if (accept === undefined) return 'all';
  if (same(accept, ACCEPT.images)) return 'images';
  if (same(accept, ACCEPT.documents)) return 'documents';
  return 'custom';
}

const at = (type: string, key: string, attr: string): string =>
  formatKeyPath(['types', type, 'properties', key, attr]);

/** One attribute of a property: set, or removed for `undefined`. */
const attrOps = (doc: Doc, type: string, key: string, attr: string, value: unknown): readonly Op[] =>
  value === undefined ? clearOps(doc, at(type, key, attr)) : setOps(doc, at(type, key, attr), value);

export const numberLimitOps = (
  doc: Doc,
  type: string,
  key: string,
  part: 'min' | 'max',
  value: number | undefined,
): readonly Op[] => attrOps(doc, type, key, part, value);

export const fileTypesOps = (doc: Doc, type: string, key: string, preset: FilePreset): readonly Op[] =>
  attrOps(doc, type, key, 'accept', preset === 'all' ? undefined : [...ACCEPT[preset]]);

export const maxFilesOps = (doc: Doc, type: string, key: string, count: number | undefined): readonly Op[] =>
  attrOps(doc, type, key, 'max_files', count);
