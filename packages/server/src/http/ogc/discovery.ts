/** Landing page, conformance declaration and collections (OGC API Features Core, Part 2 CRS). */
import { localize, type LocalizedString } from '@ueberblick/core';
import type { Ctx } from './context';
import { permsOf } from './feature';
import { CRS84 } from './seams';
import { jsonResponse } from '../shared/errors';

const F1 = 'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf';
const F2 = 'http://www.opengis.net/spec/ogcapi-features-2/1.0/conf';
const F3 = 'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf';
const F4 = 'http://www.opengis.net/spec/ogcapi-features-4/1.0/conf';
const CQL2 = 'http://www.opengis.net/spec/cql2/1.0/conf';

/** The conformance classes this server claims (docs/09). CRS needs a second CRS besides CRS84. */
export function conformanceClasses(ctx: Pick<Ctx, 'seams'>): string[] {
  const out = [`${F1}/core`, `${F1}/geojson`, `${F4}/create-replace-delete`, `${F4}/update`];
  if (ctx.seams.crs.supported.length > 1) out.push(`${F2}/crs`);
  out.push(
    `${F3}/filter`,
    `${F3}/features-filter`,
    `${CQL2}/cql2-text`,
    `${CQL2}/cql2-json`,
    `${CQL2}/basic-cql2`,
    `${CQL2}/basic-spatial-functions`,
  );
  return out;
}

const link = (rel: string, href: string, type = 'application/json', title?: string) => ({
  rel,
  href,
  type,
  ...(title ? { title } : {}),
});

export const landing = (ctx: Ctx): Response =>
  jsonResponse({
    title: `Überblick ${ctx.caller.project.key}`,
    description: 'OGC API Features access to the features of one project. Every write is a run.',
    links: [
      link('self', ctx.base, 'application/json', 'This document'),
      link('conformance', `${ctx.base}/conformance`, 'application/json', 'Conformance classes'),
      link('data', `${ctx.base}/collections`, 'application/json', 'Feature collections'),
    ],
  });

export const conformance = (ctx: Ctx): Response => jsonResponse({ conformsTo: conformanceClasses(ctx) });

/** The default languages of a deployment, appended after what the caller asked for (docs/05). */
const DEFAULT_LOCALES = ['de', 'en'] as const;
const labelOf = (ctx: Ctx, l: LocalizedString | undefined, fallback: string): string =>
  l === undefined ? fallback : localize(l, [...ctx.locales, ...DEFAULT_LOCALES]);

/** Feature types the caller can see rows of (the compiled row filter is not `none` for their subjects). */
export function visibleTypes(ctx: Ctx): string[] {
  const perms = permsOf(ctx.config);
  const subjects = perms.subjects(ctx.caller.actor);
  const now = ctx.deps.clock.now();
  return Object.keys(ctx.config.file.types ?? {})
    .filter((t) => perms.forType(t as never)?.seeSql(subjects, ctx.caller.actor, 'f', now).kind !== 'none')
    .sort();
}

export function collectionDoc(ctx: Ctx, type: string): Record<string, unknown> {
  const items = `${ctx.base}/collections/${type}/items`;
  return {
    id: type,
    title: labelOf(ctx, ctx.config.file.types?.[type]?.label, type),
    itemType: 'feature',
    crs: ctx.seams.crs.supported,
    storageCrs: CRS84,
    links: [
      link('self', `${ctx.base}/collections/${type}`, 'application/json'),
      link('items', items, 'application/geo+json', type),
    ],
  };
}

export const collections = (ctx: Ctx): Response =>
  jsonResponse({
    links: [link('self', `${ctx.base}/collections`)],
    collections: visibleTypes(ctx).map((t) => collectionDoc(ctx, t)),
  });

export const collection = (ctx: Ctx, type: string): Response => jsonResponse(collectionDoc(ctx, type));
