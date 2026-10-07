/**
 * v3 icons and per-value looks become `types.<t>.marker` and `types.<t>.classify` (WP-357, B-018).
 * v3 sources: `workflows.icon_config`, `marker_color`, `filter_value_icons` (`map-icons.ts:14-39`) and the
 * "filterable" field tag (`tag-types.ts:38-52`). The SVG is checked by core's `checkMarkerSvg` (R1); whatever cannot be
 * carried is reported on the v3 column, with the v4 problem code where one applies, never dropped silently.
 */
import type { FeatureType, Property } from '@ueberblick/core';
import { checkMarkerSvg } from '@ueberblick/core/marker';
import { MARKER_ICON_SIZE } from '@ueberblick/core';
import { valueProp, type Ctx, type TypeInfo } from './ctx';
import { isRec } from './read';
import type { Rec, SrcType } from './model';

type Look = NonNullable<FeatureType['marker']>;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;
const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);
const TRANSPARENT = new Set(['', 'transparent', 'none']);

/** `#rgb` becomes `#rrggbb`; anything that is not a hex colour is `undefined`. */
function hex(x: unknown): string | undefined {
  const s = str(x);
  if (s === undefined) return undefined;
  if (HEX6.test(s)) return s;
  if (HEX3.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return undefined;
}

/** The style fields of an icon that v4 does not carry (B-018 item 4), as `style.<name>`. */
function uncarried(style: Rec): string[] {
  const out: string[] = [];
  if (style['shape'] !== undefined && style['shape'] !== 'none') out.push('style.shape');
  if (typeof style['borderWidth'] === 'number' && style['borderWidth'] !== 0) out.push('style.borderWidth');
  const bc = style['borderColor'];
  if (typeof bc === 'string' && !TRANSPARENT.has(bc)) out.push('style.borderColor');
  const bg = style['backgroundColor'];
  if (typeof bg === 'string' && !TRANSPARENT.has(bg)) out.push('style.backgroundColor');
  if (style['shadow'] === true) out.push('style.shadow');
  return out;
}

interface Converted {
  readonly look: Look | undefined;
  /** Reasons to report on the v3 column. */
  readonly notes: string[];
}

/** One v3 `IconConfig` to a look; `label` names the icon in the notes. */
function convertIcon(raw: unknown, label: string): Converted {
  const notes: string[] = [];
  if (!isRec(raw)) return { look: undefined, notes: [`${label}: not an icon object, ignored`] };
  const svg = str(raw['svgContent']);
  if (svg === undefined) {
    return { look: undefined, notes: [`${label}: no svgContent, ignored as v3 did`] };
  }
  const style = isRec(raw['style']) ? raw['style'] : {};
  const skipped = uncarried(style);
  if (skipped.length > 0) notes.push(`${label}: ${skipped.join(', ')} not carried (B-018)`);
  const color = hex(style['color']);
  if (style['color'] !== undefined && color === undefined) {
    notes.push(`${label}: style.color is not a hex colour, dropped`);
  }
  const problems = checkMarkerSvg(svg);
  const rawSize = typeof style['size'] === 'number' ? Math.round(style['size']) : MARKER_ICON_SIZE.default;
  const size = Math.min(MARKER_ICON_SIZE.max, Math.max(MARKER_ICON_SIZE.min, rawSize));
  if (size !== rawSize) notes.push(`${label}: style.size ${rawSize} clamped to ${size}`);
  if (problems.length > 0) {
    notes.push(`${label}: marker_icon_invalid, the SVG was dropped (${problems.join('; ')})`);
    return { look: color ? { color } : undefined, notes };
  }
  return { look: { ...(color ? { color } : {}), icon: { svg, size } }, notes };
}

/** The filterable tag of v3 (the last one wins, as in v3) and where it points. */
interface Classifier {
  readonly property: string;
  /** v3 value (stage key or option label) to option key. */
  readonly options: ReadonlyMap<string, string>;
}

function classifier(
  src: SrcType,
  info: TypeInfo,
  props: Record<string, Property>,
  ctx: Ctx,
): Classifier | undefined {
  const tags = src.tags.filter((t) => t.tagType === 'filterable');
  const tag = tags[tags.length - 1];
  if (!tag) return undefined;
  for (const earlier of tags.slice(0, -1)) {
    ctx.report.approximated(
      earlier.id,
      'v3 used the last filterable tag of a workflow; this one is not the classifier',
    );
  }
  const target = `types.${info.key}.classify`;
  if (tag.prop === undefined && tag.filterBy === 'stage') {
    const p = props[info.stageKey];
    if (!p || p.type !== 'select') return undefined;
    ctx.report.approximated(
      tag.id,
      'a filterable tag on the stage becomes classify.property',
      `${target}.property`,
    );
    return { property: info.stageKey, options: info.stageOptions };
  }
  const pi = tag.prop ? valueProp(info, tag.prop) : undefined;
  const p = pi ? props[pi.key] : undefined;
  if (!pi || !p) return undefined;
  if (p.type !== 'select') {
    ctx.report.approximated(
      tag.id,
      `classify_property_invalid: a ${p.type} cannot classify (only a select or the stage can), so there is no classify; the type marker is the fallback, as v3 showed in practice`,
    );
    return undefined;
  }
  ctx.report.approximated(
    tag.id,
    'a filterable tag on a field becomes classify.property',
    `${target}.property`,
  );
  return { property: pi.key, options: pi.options };
}

/** Writes `marker` and `classify` of the type and reports every v3 column it consumed. */
export function applyLook(
  src: SrcType,
  info: TypeInfo,
  type: FeatureType,
  props: Record<string, Property>,
  ctx: Ctx,
): void {
  const { report } = ctx;
  const r = src.record;
  const target = `types.${info.key}`;
  // the type's own look: an icon with its colour, else marker_color (v3 `map-icons.ts:195-200`)
  const marker: Look = {};
  const typeIcon = 'icon_config' in r ? convertIcon(r['icon_config'], 'icon_config') : undefined;
  const mc = hex(r['marker_color']);
  if (typeIcon?.look?.icon) marker.icon = typeIcon.look.icon;
  const color = typeIcon?.look?.color ?? mc;
  if (color) marker.color = color;
  if (marker.icon || marker.color) type.marker = marker;
  if ('icon_config' in r) {
    const notes = typeIcon?.notes ?? [];
    if (marker.icon && notes.length === 0) report.mapped(`${src.id}.icon_config`, `${target}.marker.icon`);
    else report.approximated(`${src.id}.icon_config`, notes.join('; ') || 'ignored', `${target}.marker`);
  }
  if ('marker_color' in r) {
    if (mc === undefined) report.dropped(`${src.id}.marker_color`, 'not a hex colour');
    else if (typeIcon?.look?.color) {
      report.approximated(
        `${src.id}.marker_color`,
        'the icon colour wins (v3 draws the dot only without an icon)',
        `${target}.marker.color`,
      );
    } else report.mapped(`${src.id}.marker_color`, `${target}.marker.color`);
  }
  // the classifying property and its per-value looks
  const cls = classifier(src, info, props, ctx);
  const icons = isRec(r['filter_value_icons']) ? r['filter_value_icons'] : undefined;
  const id = `${src.id}.filter_value_icons`;
  const notes: string[] = [];
  if (cls) {
    const values: NonNullable<FeatureType['classify']>['values'] = {};
    for (const [k, raw] of Object.entries(icons ?? {})) {
      const optionKey = cls.options.get(k);
      if (optionKey === undefined) {
        notes.push(
          `classify_value_unknown: "${k}" is neither a stage key nor an option label (a deleted option), dropped`,
        );
        continue;
      }
      const c = convertIcon(raw, `"${k}"`);
      notes.push(...c.notes);
      if (c.look) values[optionKey] = c.look;
    }
    type.classify = { property: cls.property, values };
    if (icons) {
      if (notes.length === 0) report.mapped(id, `${target}.classify.values`);
      else report.approximated(id, notes.join('; '), `${target}.classify.values`);
    }
  } else if (icons) {
    report.dropped(
      id,
      'no classify (the workflow has no filterable tag on a stage or a single-choice field), so v3 never drew these icons either',
    );
  }
}
