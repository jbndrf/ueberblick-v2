// The drawing of a marker look as one SVG string (v3 `map-icons.ts`: `standaloneIconSpec`, `dotIconSpec`): the map
// rasterises it, the sheets draw it inline. Pure string work, no DOM. An inline `{ svg }` icon was checked at compile
// (`checkMarkerSvg`), so it is safe to draw as markup.
import type { ResolvedMarker } from '@ueberblick/core/marker';
import { MARKER_ICON_BODIES } from './maplibre/marker-icon-bodies';

const NS = 'http://www.w3.org/2000/svg';
/** The dot of a feature with no icon: v3's 24 px circle with a white ring. */
export const DOT_SIZE = 24;

/** `svg` with a definite pixel size and a viewBox, so its artwork scales to it (v3 `normalizeSvg`). */
export function sizedSvg(svg: string, px: number): string {
  const m = /<svg\b([^>]*)>/i.exec(svg);
  if (m === null) return svg;
  const attr = (name: string): string | undefined =>
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
      .exec(m[1] ?? '')
      ?.slice(1)
      .find((v) => v !== undefined);
  const w = parseFloat(attr('width') ?? '');
  const h = parseFloat(attr('height') ?? '');
  const viewBox = attr('viewBox') ?? `0 0 ${Number.isFinite(w) ? w : 24} ${Number.isFinite(h) ? h : 24}`;
  let attrs = m[1] ?? '';
  for (const name of ['width', 'height', 'viewBox', 'xmlns'])
    attrs = attrs.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'gi'), '');
  return svg.replace(
    m[0],
    `<svg xmlns="${NS}"${attrs.replace(/\/$/, '')} viewBox="${viewBox}" width="${px}" height="${px}">`,
  );
}

const dot = (color: string): string =>
  `<svg xmlns="${NS}" width="${DOT_SIZE}" height="${DOT_SIZE}" viewBox="0 0 ${DOT_SIZE} ${DOT_SIZE}"><circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/><circle cx="12" cy="12" r="6" fill="white" opacity="0.8"/></svg>`;

/** The svg of a registry icon, stroked in `color` (the lucide drawing on its 24 grid). `undefined` for a key with no drawing. */
function keyIcon(key: string, color: string, px: number): string | undefined {
  const body = MARKER_ICON_BODIES[key];
  return body === undefined
    ? undefined
    : `<svg xmlns="${NS}" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/**
 * One look as an svg of `px` pixels (default: the look's own size): the icon, or the dot in the look's colour.
 * A registry icon is drawn in the colour; an inline icon keeps its own (v3 stored the colour inside the svg).
 */
export function markerSvg(look: ResolvedMarker, px?: number): string {
  const icon = look.icon;
  const size = px ?? look.size;
  if (icon === undefined) return px === undefined ? dot(look.color) : sizedSvg(dot(look.color), px);
  if ('key' in icon) return keyIcon(icon.key, look.color, size) ?? dot(look.color);
  return sizedSvg(icon.svg, size);
}

/** The look as a `data:` URL for an `<img>`: a sheet draws an icon without inserting markup, so a script in an svg could never run. */
export function markerSvgUrl(look: ResolvedMarker, px?: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markerSvg(look, px))}`;
}
