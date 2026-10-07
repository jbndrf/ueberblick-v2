/**
 * What the Icons dialog of an Objektart writes, as document ops (WP-356, S3-25, B-018). v3's per-workflow icon
 * (`icon_config`, `marker_color`) is `types.<t>.marker`; its per-stage and per-value icons (`filter_value_icons`) are
 * `types.<t>.classify.values.<option>`, and the "filterable" tag that named the classifying property is
 * `types.<t>.classify.property`: one `select` property of the type, the stage property included. Headless: every
 * function takes a `Doc` and returns the next one; the page's server module saves it. Compile problems come from the
 * Doc itself (core's checker); the SVG gate is core's `checkMarkerSvg`, the same one `compile()` runs (R1).
 */
import {
  checkMarkerSvg,
  defineRegistry,
  formatKeyPath,
  localize,
  MARKER_ICON_SIZE,
  MARKER_ICONS,
  type KeyOf,
  type Problem,
} from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps, setOps } from '../../lenses/task/edit';
import { labelOf } from '../../shell/location';

/** A colour and an icon: one entry of `classify.values`, or the `marker` of the type. */
export interface IconLook {
  readonly color?: string | undefined;
  readonly icon?: IconShape | undefined;
}
/** An icon the designer writes: a registry key or an inline SVG, with an optional size. */
export type IconShape =
  | { readonly key: string; readonly size?: number | undefined }
  | { readonly svg: string; readonly size?: number | undefined }
  /** A bundle file the designer never writes (ingestion embeds it as `{ svg }`); read only. */
  | { readonly $ref: string; readonly size?: number | undefined };

/** Why an icon edit was not made; the route turns each into the page's refusal text. */
export const ICON_ERRORS = defineRegistry([
  { key: 'unknown_type', description: 'The type is not in the project file.' },
  { key: 'property_invalid', description: 'The classifying property is not a select property of the type.' },
  { key: 'no_property', description: 'No classifying property is picked, so a value has no place to go.' },
  { key: 'unknown_value', description: 'The value is not an option of the classifying property.' },
  { key: 'invalid_svg', description: "The inline SVG fails core's check (`checkMarkerSvg`)." },
  { key: 'invalid_size', description: 'The icon size is not a whole number from 8 to 128.' },
  { key: 'invalid_color', description: 'The colour is not #rrggbb.' },
  { key: 'invalid_icon', description: 'The icon is neither a registry key nor an inline SVG.' },
  { key: 'problem', description: 'The edit would leave a compile problem at the type.' },
  { key: 'refused', description: 'The document model refused the edit (a lock, a schema problem).' },
  { key: 'no_version', description: 'Nothing is deployed yet, so there is no draft to edit.' },
  { key: 'conflict', description: 'The draft was saved by someone else in the meantime.' },
] as const);
export type IconErrorCode = KeyOf<typeof ICON_ERRORS>;

export type IconEdit =
  | { readonly ok: true; readonly doc: Doc }
  | { readonly ok: false; readonly code: IconErrorCode; readonly detail?: string };

export interface IconChoice {
  readonly key: string;
  readonly label: string;
  /** Set on an option of the stage property: whether it starts or ends the process (v3's Start / Step / End badge). */
  readonly stage?: { readonly start: boolean; readonly end: boolean };
}

/** What the dialog shows of one type. */
export interface IconsState {
  readonly type: string;
  /** The picked classifying property and its entries; null is "keine". */
  readonly classify: {
    readonly property: string;
    readonly values: Readonly<Record<string, IconLook>>;
  } | null;
  readonly marker: IconLook | null;
  /** The properties the picker offers: every `select` property of the type (the stage property is one), with its option keys. */
  readonly selects: readonly (IconChoice & { readonly optionKeys: readonly string[] })[];
  /** The options of the classifying property in file order, with their labels from `options`; empty with no property. */
  readonly options: readonly IconChoice[];
  /** The key of the stage property (`process.property`), if the type has a process. */
  readonly stage: string | null;
}

type Source = Pick<Doc, 'effective'>;
type TypeOf = NonNullable<ReturnType<Doc['effective']>['types']>[string];
const typeOf = (doc: Source, type: string): TypeOf | undefined => doc.effective().types?.[type];
const typePath = (type: string): string => formatKeyPath(['types', type]);
const classifyPath = (type: string): string => formatKeyPath(['types', type, 'classify']);
const markerPath = (type: string): string => formatKeyPath(['types', type, 'marker']);
const valuePath = (type: string, value: string): string =>
  formatKeyPath(['types', type, 'classify', 'values', value]);

function optionsOf(
  t: TypeOf | undefined,
  property: string | undefined,
  locale: string,
): readonly IconChoice[] {
  const p = property === undefined ? undefined : t?.properties[property];
  if (p?.type !== 'select') return [];
  const process = t?.process?.property === property ? t?.process : undefined;
  return Object.entries(p.options ?? {}).map(([key, label]) => ({
    key,
    label: localize(label, [locale]) || key,
    ...(process === undefined
      ? {}
      : { stage: { start: process.start === key, end: process.end.includes(key) } }),
  }));
}

export function iconsState(doc: Source, type: string, locale: string): IconsState {
  const t = typeOf(doc, type);
  const selects: IconsState['selects'][number][] = [];
  for (const [key, p] of Object.entries(t?.properties ?? {}))
    if (p.type === 'select')
      selects.push({ key, label: labelOf(p.label, locale, key), optionKeys: Object.keys(p.options ?? {}) });
  const classify = t?.classify ?? null;
  return {
    type,
    classify: classify === null ? null : { property: classify.property, values: classify.values },
    marker: t?.marker ?? null,
    selects,
    options: optionsOf(t, classify?.property, locale),
    stage: t?.process?.property ?? null,
  };
}

/** The entries of the dialog's classify that a switch to `property` (null: "keine") would drop. */
export function droppedFor(state: IconsState, property: string | null): readonly string[] {
  const have = Object.keys(state.classify?.values ?? {});
  if (property === null) return have;
  const keep = new Set(state.selects.find((p) => p.key === property)?.optionKeys);
  return have.filter((k) => !keep.has(k));
}

/** The same for a document: what `setClassifyProperty` would drop. */
export const droppedValues = (doc: Source, type: string, property: string | null): readonly string[] =>
  droppedFor(iconsState(doc, type, 'en'), property);

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The first reason an icon look is not acceptable, in the order v3's designer checked: SVG, size; then colour. */
export function checkLook(look: IconLook): { code: IconErrorCode; detail?: string } | null {
  const icon = look.icon;
  if (icon !== undefined) {
    if ('svg' in icon) {
      const problems = checkMarkerSvg(icon.svg);
      if (problems.length > 0) return { code: 'invalid_svg', detail: problems.join('; ') };
    } else if ('$ref' in icon || !(MARKER_ICONS.keys as readonly string[]).includes(icon.key)) {
      return { code: 'invalid_icon' };
    }
    const size = icon.size;
    if (
      size !== undefined &&
      (!Number.isInteger(size) || size < MARKER_ICON_SIZE.min || size > MARKER_ICON_SIZE.max)
    )
      return { code: 'invalid_size' };
  }
  if (look.color !== undefined && !HEX.test(look.color)) return { code: 'invalid_color' };
  return null;
}

const problemKey = (p: Problem): string => `${p.code}|${p.path}|${JSON.stringify(p.message)}`;

/** Applies the ops; refuses on the Doc's own refusal, or when a problem at the type appears that the document did not have. */
function run(doc: Doc, type: string, ops: readonly Op[], locale: string): IconEdit {
  if (ops.length === 0) return { ok: true, doc };
  const before = new Set(doc.problems().map(problemKey));
  let cur = doc;
  let problems = doc.problems();
  for (const op of ops) {
    const r = cur.apply(op);
    if (r.refused !== undefined) return { ok: false, code: 'refused', detail: r.refused.message };
    cur = r.doc;
    problems = r.problems;
  }
  const scope = typePath(type);
  const fresh = problems.find((p) => p.path.startsWith(scope) && !before.has(problemKey(p)));
  if (fresh !== undefined)
    return { ok: false, code: 'problem', detail: labelOf(fresh.message, locale, fresh.code) };
  return { ok: true, doc: cur };
}

/** Drops `undefined` fields, so the file holds exactly the B-018 keys. */
const clean = (look: IconLook): IconLook => ({
  ...(look.color !== undefined ? { color: look.color } : {}),
  ...(look.icon !== undefined ? { icon: look.icon } : {}),
});

/**
 * Picks the classifying property (null: "keine", which removes `classify`). A switch keeps the `values` whose key is an
 * option of the new property and drops the others (`droppedValues` says which, so the page can ask first).
 */
export function setClassifyProperty(
  doc: Doc,
  type: string,
  property: string | null,
  locale: string,
): IconEdit {
  const t = typeOf(doc, type);
  if (t === undefined) return { ok: false, code: 'unknown_type' };
  if (property === null)
    return run(doc, type, t.classify === undefined ? [] : clearOps(doc, classifyPath(type)), locale);
  if (t.properties[property]?.type !== 'select') return { ok: false, code: 'property_invalid' };
  if (t.classify === undefined) {
    const from = doc.template.types?.[type]?.classify;
    if (from === undefined || doc.overlay().hide?.includes(classifyPath(type)) !== true)
      return run(doc, type, setOps(doc, classifyPath(type), { property, values: {} }), locale);
    // "keine" hid the template's classify: bring it back empty, so the old entries do not return
    const ops: Op[] = [{ kind: 'unhide', path: classifyPath(type) }];
    if (from.property !== property)
      ops.push({ kind: 'set', path: `${classifyPath(type)}.property`, value: property });
    for (const k of Object.keys(from.values)) ops.push({ kind: 'hide', path: valuePath(type, k) });
    return run(doc, type, ops, locale);
  }
  if (t.classify.property === property) return { ok: true, doc };
  const ops = [
    ...setOps(doc, `${classifyPath(type)}.property`, property),
    ...droppedValues(doc, type, property).flatMap((k) => clearOps(doc, valuePath(type, k))),
  ];
  return run(doc, type, ops, locale);
}

/** Sets the colour and icon of one value of the classifying property (v3 `updateFilterValueIcons`). */
export function setValueIcon(
  doc: Doc,
  type: string,
  value: string,
  look: IconLook,
  locale: string,
): IconEdit {
  const t = typeOf(doc, type);
  if (t === undefined) return { ok: false, code: 'unknown_type' };
  if (t.classify === undefined) return { ok: false, code: 'no_property' };
  if (!optionsOf(t, t.classify.property, locale).some((o) => o.key === value))
    return { ok: false, code: 'unknown_value' };
  const bad = checkLook(look);
  if (bad !== null) return { ok: false, ...bad };
  return run(doc, type, setOps(doc, valuePath(type, value), clean(look)), locale);
}

/** Clears one value's entry. The last one leaves `values` empty: the schema keeps the key, "keine" removes `classify`. */
export function clearValueIcon(doc: Doc, type: string, value: string, locale: string): IconEdit {
  const t = typeOf(doc, type);
  if (t === undefined) return { ok: false, code: 'unknown_type' };
  if (t.classify?.values[value] === undefined) return { ok: true, doc };
  return run(doc, type, clearOps(doc, valuePath(type, value)), locale);
}

/** Sets the icon and colour of the type itself (v3 `updateIconConfig` and `marker_color`). */
export function setMarker(doc: Doc, type: string, look: IconLook, locale: string): IconEdit {
  if (typeOf(doc, type) === undefined) return { ok: false, code: 'unknown_type' };
  const bad = checkLook(look);
  if (bad !== null) return { ok: false, ...bad };
  return run(doc, type, setOps(doc, markerPath(type), clean(look)), locale);
}

export function clearMarker(doc: Doc, type: string, locale: string): IconEdit {
  const t = typeOf(doc, type);
  if (t === undefined) return { ok: false, code: 'unknown_type' };
  return run(doc, type, t.marker === undefined ? [] : clearOps(doc, markerPath(type)), locale);
}
