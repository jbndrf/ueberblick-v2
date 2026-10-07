/**
 * WP-713: no raw key in the participant UI. v3 required a label on every field (its fallback was the key itself,
 * reference/src/routes/(participant)/map/+page.svelte:1446 `ff.label ?? shortLabel(ff.id)`), so a golden template that
 * the participant app shows must label every property, and name it in English too where the type has an English label.
 */
import { describe, expect, it } from 'vitest';
import { goldenConfig, goldenFiles, goldenYaml } from '@ueberblick/core/testing';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';

interface Label {
  readonly [locale: string]: string;
}
interface Doc {
  readonly roles?: Record<string, { readonly label?: Label | string }>;
  readonly types?: Record<
    string,
    {
      readonly label?: Label | string;
      readonly properties?: Record<string, { readonly type: string; readonly label?: Label | string }>;
    }
  >;
}

const TEMPLATES = [
  'veranstaltung/1.0.0',
  'baumkataster/1.0.0',
  'baumkataster/1.1.0',
  'baumkataster/2.0.0',
  'maengelmelder/1.0.0',
] as const;
/** A plain string applies to every locale (scenario i18n/localized_labels_fallback). */
const hasText = (l: Label | string | undefined, locale = 'de'): boolean =>
  l !== undefined && (typeof l === 'string' ? l !== '' : (l[locale] ?? '') !== '');

describe.each(TEMPLATES)('golden template %s', (name) => {
  const doc = goldenYaml(`templates/${name}.yaml`) as unknown as Doc;
  const props = Object.entries(doc.types ?? {}).flatMap(([t, def]) =>
    Object.entries(def.properties ?? {}).map(([k, p]) => ({ id: `${t}.${k}`, p })),
  );

  it('labels every property in German', () => {
    expect(props.filter(({ p }) => !hasText(p.label, 'de')).map((x) => x.id)).toEqual([]);
  });

  it('labels every property in English', () => {
    expect(props.filter(({ p }) => !hasText(p.label, 'en')).map((x) => x.id)).toEqual([]);
  });

  it('labels every role in German and English', () => {
    const roles = Object.entries(doc.roles ?? {});
    expect(
      roles.filter(([, r]) => !hasText(r.label, 'de') || !hasText(r.label, 'en')).map(([k]) => k),
    ).toEqual([]);
  });
});

/**
 * WP-741: every user-visible text in a demo template or project overlay is German and English. A bare string
 * is German-only in effect (the English UI would show it unchanged), so it fails here. Walks every `label`,
 * every `options`/`option_hints` value (select options, stage names) and the dotted-path overlay additions.
 */
type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const TEXT_MAPS = new Set(['options', 'option_hints']);

/** Every user-visible text slot below `node`: [path, value]. `path` accumulates dotted overlay keys too. */
function textSlots(node: Json, path: readonly string[], out: [string, Json][]): [string, Json][] {
  if (!isObj(node)) return out;
  for (const [rawKey, value] of Object.entries(node)) {
    const here = [...path, ...rawKey.split('.')];
    const last = here[here.length - 1] as string;
    if (last === 'label') out.push([here.join('.'), value]);
    else if (TEXT_MAPS.has(last) && isObj(value)) {
      for (const [opt, text] of Object.entries(value)) out.push([`${here.join('.')}.${opt}`, text]);
    } else textSlots(value, here, out);
  }
  return out;
}
/** A number such as an option "3" reads the same in every language. */
const bilingual = (v: Json): boolean =>
  (typeof v === 'string' && /^\d+$/.test(v)) ||
  (isObj(v) && hasText(v as Label, 'de') && hasText(v as Label, 'en'));

const projectFiles = goldenFiles('projects').filter((f) => f.endsWith('.yaml') && !isPlanted(f));
const SOURCES = [...TEMPLATES.map((t) => `templates/${t}.yaml`), ...projectFiles];

describe.each(SOURCES)('de+en texts in %s', (file) => {
  const slots = textSlots(goldenYaml(file), [], []);
  it('gives every label, option and stage name a German and an English text', () => {
    expect(slots.filter(([, v]) => !bilingual(v)).map(([p]) => p)).toEqual([]);
  });
});

describe('Zuständig offers every participant of the managing role (WP-725)', () => {
  it.each(['baumkataster/1.0.0', 'baumkataster/1.1.0', 'baumkataster/2.0.0'])(
    '%s baum.zustaendig has select.all',
    (t) => {
      const doc = goldenYaml(`templates/${t}.yaml`) as unknown as {
        types: { baum: { properties: { zustaendig: { select?: { all?: string[] } } } } };
      };
      expect(doc.types.baum.properties.zustaendig.select).toEqual({ all: ['verwaltung'] });
    },
  );
});

describe('the maengelmelder template opens on its sample town (owner answer M6 a)', () => {
  it('compiles with map.start centred on Bonn, where the seeded reports are', () => {
    const cfg = goldenConfig('templates/maengelmelder/1.0.0.yaml').file as unknown as {
      map?: { start?: { center: [number, number]; zoom: number } };
    };
    const start = cfg.map?.start;
    expect(start).toBeDefined();
    expect(Math.abs((start?.center[0] ?? 0) - 7.11)).toBeLessThan(0.1);
    expect(Math.abs((start?.center[1] ?? 0) - 50.755)).toBeLessThan(0.1);
    expect(start?.zoom).toBeGreaterThanOrEqual(10);
  });
});

describe('the demo project musterstadt-baeume (compiled)', () => {
  it('offers the managing role in Zuständig on the newest baumkataster@1', () => {
    const cfg = goldenConfig('projects/musterstadt-baeume.yaml').file as unknown as {
      types: Record<string, { properties: Record<string, { select?: unknown }> }>;
    };
    expect(cfg.types['baum']?.properties['zustaendig']?.select).toEqual({ all: ['verwaltung'] });
  });
});
