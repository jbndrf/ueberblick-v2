/**
 * The look of a feature on the map, as pure functions over the compiled config (WP-674, B-018): the SVG check of an
 * inline icon (the one copy, also the builder's, R1), the v3 fallback chain and the per-value looks a renderer draws.
 * No Zod and no I/O, so participant code imports it as `@ueberblick/core/marker`; the schemas are `schema/marker.ts`.
 */
import { DEFAULT_MARKER_COLOR, MARKER_ICON_SIZE, SVG_ICON_LIMITS } from '../registry';

/** A marker icon as the config holds it: a registry key, an inline SVG, or a bundle file (embedded at compile). */
export type MarkerIconShape =
  | { readonly key: string; readonly size?: number | undefined }
  | { readonly svg: string; readonly size?: number | undefined }
  | { readonly $ref: string; readonly size?: number | undefined };

/** A colour and an icon, both optional (`marker` of a type, or one entry of `classify.values`). */
export interface MarkerLook {
  readonly color?: string | undefined;
  readonly icon?: MarkerIconShape | undefined;
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[\w:.-]/;
const SPACE = /\s/;

/**
 * One message per problem of an inline SVG; empty means the SVG may be drawn. No DOM (R2): a quote-aware tokenizer
 * that fails closed: markup it cannot read as plain elements and `name="value"` attributes (an entity or a stray
 * character in a tag, an unterminated quote) is refused, never skipped.
 */
export function checkMarkerSvg(svg: string): readonly string[] {
  const out: string[] = [];
  if (svg.length > SVG_ICON_LIMITS.max_bytes)
    out.push(`the SVG is larger than ${SVG_ICON_LIMITS.max_bytes / 1024} KB`);
  const body = svg.trim().replace(/^<\?xml[^>]*\?>\s*/, '');
  if (!/^<svg[\s>/]/.test(body)) out.push('the SVG must start with an <svg> element');
  if (/<!(DOCTYPE|ENTITY)/i.test(body)) out.push('a DOCTYPE or ENTITY is not allowed');
  if (/javascript:/i.test(body)) out.push('a javascript: URL is not allowed');
  const allowed = new Set<string>(SVG_ICON_LIMITS.elements);
  const seen = new Set<string>();
  const fail = (message: string): void => {
    if (!out.includes(message)) out.push(message);
  };
  let i = 0;
  while (i < body.length) {
    const lt = body.indexOf('<', i);
    if (lt < 0) break;
    if (body.startsWith('<!--', lt)) {
      const end = body.indexOf('-->', lt + 4);
      if (end < 0) return [...out, 'a comment is not closed'];
      i = end + 3;
      continue;
    }
    let j = lt + 1;
    const closing = body[j] === '/';
    if (closing) j++;
    if (!NAME_START.test(body[j] ?? '')) return [...out, 'the SVG has markup that is not a plain element'];
    const nameStart = j;
    while (NAME_CHAR.test(body[j] ?? '')) j++;
    const tag = body.slice(nameStart, j);
    if (!allowed.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      out.push(`the element <${tag}> is not allowed`);
    }
    // the attributes, up to the `>` that closes the tag
    for (;;) {
      while (SPACE.test(body[j] ?? '')) j++;
      const c = body[j];
      if (c === undefined) return [...out, `the tag <${tag}> is not closed`];
      if (c === '>') break;
      if (c === '/' && body[j + 1] === '>') {
        j++;
        break;
      }
      if (closing || !NAME_START.test(c))
        return [...out, `the tag <${tag}> has a character that is not allowed`];
      const aStart = j;
      while (NAME_CHAR.test(body[j] ?? '')) j++;
      const name = body.slice(aStart, j);
      if (/^on/i.test(name)) fail(`the attribute ${name} is not allowed`);
      while (SPACE.test(body[j] ?? '')) j++;
      if (body[j] !== '=') continue;
      j++;
      while (SPACE.test(body[j] ?? '')) j++;
      const q = body[j];
      let value: string;
      if (q === '"' || q === "'") {
        const end = body.indexOf(q, j + 1);
        if (end < 0) return [...out, `the attribute ${name} has an unclosed quote`];
        value = body.slice(j + 1, end);
        j = end + 1;
      } else {
        const vStart = j;
        while (j < body.length && !/[\s"'=<>`]/.test(body[j] ?? '')) j++;
        value = body.slice(vStart, j);
        if (value === '') return [...out, `the attribute ${name} has no readable value`];
      }
      if (/^(xlink:)?href$/i.test(name) && !value.startsWith('#'))
        fail(`${name} may only point inside the SVG (#id)`);
    }
    i = j + 1;
  }
  return out;
}

/** What the map draws for one feature: a colour, an optional icon, the icon's size. */
export interface ResolvedMarker {
  readonly color: string;
  /** Absent: draw the dot. A `$ref` icon never reaches here: compile embeds it. */
  readonly icon?: { readonly key: string } | { readonly svg: string };
  readonly size: number;
}

/** The type-side input of `resolveMarker` (the compiled `FeatureType` fits). */
export interface MarkerConfig {
  readonly marker?: MarkerLook | undefined;
  readonly classify?:
    { readonly property: string; readonly values: { readonly [value: string]: MarkerLook } } | undefined;
}

type DrawableIcon = Exclude<MarkerIconShape, { $ref: string }>;
const drawable = (icon: MarkerIconShape | undefined): icon is DrawableIcon =>
  icon !== undefined && !('$ref' in icon);

/**
 * The fallback chain of v3 (`map-icons.ts:175-200`, `+page.svelte:555-590`): the value's look, then the type's
 * `marker`, then the default dot. Colour and icon fall back one by one; the size is the chosen icon's own.
 * `value` is the classifying property's value of the feature (a `select` holds one string; anything else, none).
 */
export function resolveMarker(type: MarkerConfig, value: unknown): ResolvedMarker {
  const own = typeof value === 'string' ? type.classify?.values[value] : undefined;
  const icon = drawable(own?.icon) ? own.icon : drawable(type.marker?.icon) ? type.marker.icon : undefined;
  const color = own?.color ?? type.marker?.color ?? DEFAULT_MARKER_COLOR;
  if (icon === undefined) return { color, size: MARKER_ICON_SIZE.default };
  const shape = 'key' in icon ? { key: icon.key } : { svg: icon.svg };
  return { color, icon: shape, size: icon.size ?? MARKER_ICON_SIZE.default };
}

/** The type-side input of `classifyingProperty` (the compiled `FeatureType` fits). */
export interface ClassifyingConfig {
  readonly classify?: { readonly property: string } | undefined;
  readonly process?: { readonly property: string } | undefined;
}

/**
 * The select property that groups features of a type: the Einfach value switches, the cluster-detail rows and the
 * per-value look. `classify.property`, else the stage property of the type's process (v3's `filterBy: stage` default
 * for a type that names no field), else none.
 */
export const classifyingProperty = (type: ClassifyingConfig): string | undefined =>
  type.classify?.property ?? type.process?.property;

/**
 * What a map renderer needs to draw one type by value (H1: no renderer names): the property whose value picks the
 * look, each value's resolved look, and the look of a feature whose value has none. `undefined` when the type
 * names neither a `marker` nor a `classify`: the renderer then draws its default.
 */
export interface MarkerLooks {
  readonly property: string | undefined;
  readonly values: { readonly [value: string]: ResolvedMarker };
  readonly fallback: ResolvedMarker;
}

export function markerLooks(type: MarkerConfig): MarkerLooks | undefined {
  if (type.marker === undefined && type.classify === undefined) return undefined;
  const values: Record<string, ResolvedMarker> = {};
  for (const value of Object.keys(type.classify?.values ?? {})) values[value] = resolveMarker(type, value);
  return { property: type.classify?.property, values, fallback: resolveMarker(type, undefined) };
}

/**
 * The property a feature on the map carries to name its look (WP-744). A map draws features of several Objektarten
 * in one symbol layer (v3 `map-icons.ts:1-14`), and two types may classify by properties of the same name, so the look
 * is picked by one key per feature: the Objektart, and the classifying value when the type lists a look for it.
 */
export const LOOK_KEY = '$look';

/**
 * The property a parent feature on the map carries when it has open children at its position (B-019, v3
 * `FamilyStack.openCount`): their number. The renderer draws the badge from it; absent when there are none.
 */
export const FAMILY_OPEN_KEY = '$familyOpen';

const LOOK_SEPARATOR = '|';

/** The look key of a feature of `typeKey` whose classifying property holds `value`; `undefined` when the type has no look. */
export function lookKeyOf(typeKey: string, type: MarkerConfig, value: unknown): string | undefined {
  if (type.marker === undefined && type.classify === undefined) return undefined;
  return typeof value === 'string' && type.classify?.values[value] !== undefined
    ? `${typeKey}${LOOK_SEPARATOR}${value}`
    : typeKey;
}

/** The look key of a feature given its properties (the classifying property is read from them). */
export function lookKeyOfProperties(
  typeKey: string,
  type: MarkerConfig,
  properties: { readonly [key: string]: unknown },
): string | undefined {
  const by = type.classify?.property;
  return lookKeyOf(typeKey, type, by === undefined ? undefined : properties[by]);
}

/**
 * The looks of every Objektart a map draws, by `LOOK_KEY` (WP-744). The same `resolveMarker` as the filter sheet
 * (`markerLooks` for one type), so the map and the sheet cannot differ. `undefined` when no drawn type has a look.
 */
export function viewLooks(
  types: { readonly [typeKey: string]: MarkerConfig | undefined },
  drawn: readonly string[],
): MarkerLooks | undefined {
  const values: Record<string, ResolvedMarker> = {};
  for (const typeKey of drawn) {
    const type = types[typeKey];
    if (type === undefined || lookKeyOf(typeKey, type, undefined) === undefined) continue;
    values[typeKey] = resolveMarker(type, undefined);
    for (const value of Object.keys(type.classify?.values ?? {}))
      values[`${typeKey}${LOOK_SEPARATOR}${value}`] = resolveMarker(type, value);
  }
  if (Object.keys(values).length === 0) return undefined;
  return { property: LOOK_KEY, values, fallback: resolveMarker({}, undefined) };
}
