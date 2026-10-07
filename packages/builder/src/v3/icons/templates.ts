/**
 * v3's icon templates (`lib/utils/svg-icon-templates.ts`) and how a template becomes the file's icon (WP-356). All
 * paths use `viewBox="0 0 24 24"` and `currentColor`. A template that matches a registry key (`MARKER_ICONS`) writes
 * `{ key }` (the participant app strokes it in the colour); the others write `{ svg }`, with the colour baked in as v3's
 * `compositeIconSvg` did. Headless; the labels are looked up by `id` in the page's catalogue.
 */
import { MARKER_ICON_SIZE } from '@ueberblick/core';
import type { IconShape } from './ops';

export interface IconTemplate {
  readonly id: string;
  /** Raw SVG content without the `<svg>` wrapper. */
  readonly path: string;
  /** The `MARKER_ICONS` key that draws the same thing; set only where one exists (v3 pin and flag). */
  readonly registryKey?: string;
}

export interface IconBadge {
  readonly id: string;
  readonly color: string;
  readonly path: string;
}

const stroke = (d: string, w: number): string =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const ICON_TEMPLATES: readonly IconTemplate[] = [
  { id: 'circle', path: '<circle cx="12" cy="12" r="10" fill="currentColor"/>' },
  { id: 'square', path: '<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/>' },
  { id: 'triangle', path: '<path d="M12 2L22 20H2L12 2Z" fill="currentColor"/>' },
  { id: 'diamond', path: '<path d="M12 2L22 12L12 22L2 12L12 2Z" fill="currentColor"/>' },
  { id: 'hexagon', path: '<path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2Z" fill="currentColor"/>' },
  { id: 'pentagon', path: '<path d="M12 2l9.51 6.91L18.54 20H5.46L2.49 8.91L12 2Z" fill="currentColor"/>' },
  {
    id: 'pin',
    registryKey: 'map-pin',
    path: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" fill="currentColor"/>',
  },
  { id: 'flag', registryKey: 'flag', path: stroke('M5 2v20M5 4h11l-3 4 3 4H5', 2) },
  { id: 'cross', path: stroke('M12 5v14M5 12h14', 3) },
];

export const ICON_BADGES: readonly IconBadge[] = [
  { id: 'check', color: '#16A34A', path: stroke('M20 6L9 17l-5-5', 3.75) },
  {
    id: 'question',
    color: '#DC2626',
    path: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5"/>${stroke('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 2.5)}<circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="currentColor" stroke-width="1.25"/>`,
  },
  {
    id: 'exclamation',
    color: '#CA8A04',
    path: `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" fill="none" stroke="currentColor" stroke-width="2.5"/>${stroke('M12 9v4', 2.5)}<circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="currentColor" stroke-width="1.25"/>`,
  },
  {
    id: 'info',
    color: '#2563EB',
    path: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5"/>${stroke('M12 16v-4', 2.5)}<circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="currentColor" stroke-width="1.25"/>`,
  },
  { id: 'x-mark', color: '#DC2626', path: stroke('M18 6L6 18M6 6l12 12', 3.75) },
  {
    id: 'clock',
    color: '#EA580C',
    path: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5"/>${stroke('M12 6v6l4 2', 2.5)}`,
  },
];

export interface ComposeInput {
  readonly template: IconTemplate;
  readonly color: string;
  readonly size?: number | undefined;
  readonly badge?: IconBadge | undefined;
}

/** v3's `compositeIconSvg` for a template: the colour baked in, an optional badge in the top right corner. */
export function templateSvg({
  template,
  color,
  size = MARKER_ICON_SIZE.default,
  badge,
}: ComposeInput): string {
  const parts = [
    `<svg x="0" y="0" width="${size}" height="${size}" viewBox="0 0 24 24">${template.path.replaceAll('currentColor', color)}</svg>`,
  ];
  if (badge !== undefined) {
    const b = size * 0.4;
    const x = size - b;
    parts.push(
      `<circle cx="${x + b / 2}" cy="${b / 2}" r="${b / 2 + 1}" fill="white"/>`,
      `<svg x="${x}" y="0" width="${b}" height="${b}" viewBox="0 0 24 24">${badge.path.replaceAll('currentColor', badge.color)}</svg>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${parts.join('')}</svg>`;
}

/** The icon the file gets for a template: `{ key }` where a registry key draws it (and no badge is asked), else `{ svg }`. */
export function templateIcon(input: ComposeInput): IconShape {
  const size =
    input.size === undefined || input.size === MARKER_ICON_SIZE.default ? {} : { size: input.size };
  if (input.template.registryKey !== undefined && input.badge === undefined)
    return { key: input.template.registryKey, ...size };
  return { svg: templateSvg(input), ...size };
}
