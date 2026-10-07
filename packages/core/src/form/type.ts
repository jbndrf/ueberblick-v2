/**
 * The `type` issue: does a non-empty value fit its property (type, declared options, integer, min/max,
 * geometry kind)? One checker per registry property type, so a new type fails the compiler until it
 * has one. Structural checks only (no Zod: this runs on the device).
 */
import type { Json } from '../model';
import { DEFAULT_MAX_FILES, type FileFault, type PropertyTypeKey } from '../registry';
import type { Property } from '../schema/property';

type Check = (p: Property, v: Json) => boolean;

const isObject = (v: Json): v is { readonly [k: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: Json): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: Json | undefined): v is string => typeof v === 'string';
const inRange = (p: Property, n: number): boolean =>
  (p.min === undefined || n >= p.min) && (p.max === undefined || n <= p.max);
const hasOption = (p: Property, v: Json): boolean =>
  isString(v) && p.options !== undefined && Object.hasOwn(p.options, v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const isFileRef = (v: Json): boolean =>
  isObject(v) && isString(v.sha256) && v.sha256 !== '' && isString(v.name) && isString(v.mime);

type NamedFile = { readonly name: string; readonly mime: string };

/** Does one `accept` entry (MIME, `type/*`, or `.ext`) match a file? */
const matchesAccept = (pattern: string, f: NamedFile): boolean => {
  const pat = pattern.toLowerCase();
  if (pat.startsWith('.')) return f.name.toLowerCase().endsWith(pat);
  const mime = f.mime.toLowerCase();
  return pat.endsWith('/*') ? mime.startsWith(pat.slice(0, -1)) : mime === pat;
};

/** True when `accept` is absent or one of its entries matches the file (the tool and the check agree). */
export const fileAccepted = (accept: readonly string[] | undefined, f: NamedFile): boolean =>
  accept === undefined || accept.some((a) => matchesAccept(a, f));

/** Why a `file` value is refused (registry `FILE_FAULTS`), or undefined when it fits the property. */
export function fileFault(p: Property, v: Json): FileFault | undefined {
  if (!Array.isArray(v) || !v.every(isFileRef)) return 'malformed_file';
  if (v.length > (p.max_files ?? DEFAULT_MAX_FILES)) return 'too_many_files';
  const refs = v as readonly NamedFile[];
  return refs.every((f) => fileAccepted(p.accept, f)) ? undefined : 'file_not_accepted';
}

/** A participant or reference value: one id, or with cardinality many a list of ids (Mehrfachauswahl). */
const idsFit = (p: Property, v: Json): boolean =>
  p.cardinality === 'many' ? Array.isArray(v) && v.every(isString) : isString(v);

const CHECKS: Readonly<Record<PropertyTypeKey, Check>> = {
  text: (_p, v) => isString(v),
  localized_text: (_p, v) => isObject(v) && Object.values(v).every(isString),
  number: (p, v) => isNumber(v) && inRange(p, v),
  integer: (p, v) => isNumber(v) && Number.isInteger(v) && inRange(p, v),
  boolean: (_p, v) => typeof v === 'boolean',
  date: (_p, v) => isString(v) && DATE.test(v) && !Number.isNaN(Date.parse(v)),
  datetime: (_p, v) => isString(v) && DATETIME.test(v) && !Number.isNaN(Date.parse(v)),
  time: (_p, v) => isString(v) && TIME.test(v),
  select: hasOption,
  multiselect: (p, v) => Array.isArray(v) && v.every((x) => hasOption(p, x)),
  geometry: (p, v) =>
    isObject(v) &&
    isString(v.type) &&
    (p.geometry_type === undefined || p.geometry_type === 'any' || v.type.toLowerCase() === p.geometry_type),
  participant: (p, v) => idsFit(p, v),
  role: (p, v) => idsFit(p, v),
  reference: (p, v) => idsFit(p, v),
  file: (p, v) => fileFault(p, v) === undefined,
};

/** True when a non-empty value fits the property. */
export const typeFits = (p: Property, v: Json): boolean => CHECKS[p.type](p, v);
