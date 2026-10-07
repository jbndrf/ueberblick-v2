import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { openProject, type Doc } from '@ueberblick/builder';
import { compile, NO_ASSETS, toolAvailabilityFor } from '@ueberblick/core';
import { defaultSelection } from '@ueberblick/core/registry';
import { embedGoldenSource } from '@ueberblick/core/testing';
import {
  CLUSTER_TOOL,
  FILTER_VIEWS_TOOL,
  setStartup,
  setToolStart,
  startupView,
  toolStartView,
} from './start-doc';
import type { SettingsEdit } from './settings-doc';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
/** The demo template offers `views` and `cluster` (WP-671); these specs start from a project that declares neither. */
const withoutDemoTools = (src: string): string => {
  const file = parse(src) as {
    tools?: Record<string, unknown>;
    roles?: Record<string, { app?: { tools?: Record<string, unknown> } }>;
  };
  for (const t of ['views', 'cluster']) {
    delete file.tools?.[t];
    for (const role of Object.values(file.roles ?? {})) delete role.app?.tools?.[t];
  }
  return stringify(file);
};
const open = (): Doc =>
  openProject(
    withoutDemoTools(golden('templates/baumkataster/1.1.0.yaml')),
    golden('projects/musterstadt-baeume.yaml'),
  );
const must = (r: SettingsEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
/** The baumkataster template has the base layer `osm`; two more are added the way the Kartenebenen page will. */
function withLayers(): Doc {
  let doc = open();
  const layers = {
    luftbild: {
      label: { de: 'Luftbild' },
      kind: 'base',
      source: { type: 'xyz', url: 'https://t.example/{z}/{x}/{y}.png' },
    },
    flur: {
      label: { de: 'Flurkarte' },
      kind: 'overlay',
      source: { type: 'xyz', url: 'https://f.example/{z}/{x}/{y}.png' },
    },
  };
  for (const [key, value] of Object.entries(layers)) doc = applyOne(doc, `map.layers.${key}`, value);
  return doc;
}
function applyOne(doc: Doc, path: string, value: unknown): Doc {
  const r = doc.apply({ kind: 'set', path, value });
  if (r.refused) throw new Error(r.refused.message);
  return r.doc;
}
const mapOf = (doc: Doc) => {
  const map = compiled(doc).map;
  if (map === undefined) throw new Error('no map section');
  return map;
};
/** What a participant would read after a publish: the file compiled, then the shared helper. */
const compiled = (doc: Doc) => {
  const r = compile(doc.effective(), { assets: NO_ASSETS });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config.file;
};

describe('Erststart: the layers on at start (v3 StartupSection base layer and overlays)', () => {
  it('lists the layers with their kind and whether they are on at start', () => {
    const v = startupView(withLayers().effective(), 'de');
    expect(v.layers.map((l) => [l.key, l.kind, l.on])).toEqual([
      ['osm', 'base', true],
      ['luftbild', 'base', false],
      ['flur', 'overlay', false],
    ]);
    expect(v.layers[1]?.label).toBe('Luftbild');
  });

  it('has no layers for a file without a map section', () => {
    const doc = openProject(
      golden('templates/veranstaltung/1.0.0.yaml'),
      golden('projects/ordnungsamt-veranstaltungen.yaml'),
    );
    expect(startupView(doc.effective(), 'de').layers).toEqual([]);
  });

  it('round-trips a base and overlays through the draft, compiles, and the participant default follows', () => {
    const doc = must(setStartup(withLayers(), { base: 'luftbild', overlays: ['flur'], types: {} }));
    expect(doc.dirty).toBe(true);
    expect(doc.problems()).toEqual(open().problems());
    expect(defaultSelection(mapOf(doc))).toEqual({ base: 'luftbild', overlays: ['flur'] });
    const v = startupView(doc.effective(), 'de');
    expect(v.layers.filter((l) => l.on).map((l) => l.key)).toEqual(['luftbild', 'flur']);
  });

  it('"the first base layer" (null) clears every base flag, so the first base wins', () => {
    const doc = must(setStartup(withLayers(), { base: null, overlays: [], types: {} }));
    expect(defaultSelection(mapOf(doc))).toEqual({ base: 'osm', overlays: [] });
    expect(startupView(doc.effective(), 'de').layers.every((l) => !l.on)).toBe(true);
  });

  it('leaves the file as it was when nothing changes', () => {
    const before = withLayers();
    const doc = must(setStartup(before, { base: 'osm', overlays: [], types: {} }));
    expect(doc.overlay()).toEqual(before.overlay());
  });

  it('refuses a layer that does not exist or has the wrong kind', () => {
    const r = setStartup(withLayers(), { base: 'flur', overlays: [], types: {} });
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(setStartup(withLayers(), { base: null, overlays: ['osm'], types: {} })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(setStartup(withLayers(), { base: null, overlays: ['nope'], types: {} })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });

  it('property: any base and any overlay subset reads back exactly and compiles', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<string | null>(null, 'osm', 'luftbild'),
        fc.subarray(['flur']),
        (base, overlays) => {
          const doc = must(setStartup(withLayers(), { base, overlays, types: {} }));
          const sel = defaultSelection(mapOf(doc));
          expect(sel.base).toBe(base ?? 'osm');
          expect([...sel.overlays]).toEqual(overlays);
        },
      ),
    );
  }, 30_000);
});

describe('Cluster and Filter & Felder: "Beim Start aktiv" per role (v3 enabled_features)', () => {
  const roles = () => ['kontrolle', 'bauhof', 'verwaltung'];

  it('shows a tool the project does not declare as not offered to any role', () => {
    const v = toolStartView(open().effective(), CLUSTER_TOOL, 'de');
    expect(v.declared).toBe(false);
    expect(v.roles.map((r) => [r.key, r.state])).toEqual(roles().map((k) => [k, 'none']));
    expect(v.roles[0]?.label).toBe('Baumkontrolle');
  });

  it('on for all roles declares the tool and lists it as active for each role', () => {
    const doc = must(setToolStart(open(), CLUSTER_TOOL, null, true));
    expect(doc.problems()).toEqual(open().problems());
    const file = compiled(doc);
    expect(file.tools).toHaveProperty(CLUSTER_TOOL);
    for (const r of roles()) expect(toolAvailabilityFor(file, [r], CLUSTER_TOOL)).toBe('active');
    // the roles keep what they had
    expect(Object.keys(file.roles?.['bauhof']?.app?.tools ?? {})).toEqual(['photo', CLUSTER_TOOL]);
    const v = toolStartView(doc.effective(), CLUSTER_TOOL, 'de');
    expect(v.declared).toBe(true);
    expect(v.roles.every((r) => r.state === 'active')).toBe(true);
  });

  it('off for all roles makes the tool offered (the person may switch it on), not removed', () => {
    let doc = must(setToolStart(open(), CLUSTER_TOOL, null, true));
    doc = must(setToolStart(doc, CLUSTER_TOOL, null, false));
    const file = compiled(doc);
    for (const r of roles()) expect(toolAvailabilityFor(file, [r], CLUSTER_TOOL)).toBe('offered');
    expect(toolStartView(doc.effective(), CLUSTER_TOOL, 'de').roles.map((r) => r.state)).toEqual([
      'offered',
      'offered',
      'offered',
    ]);
  });

  it('one role only: the others keep their state', () => {
    const doc = must(setToolStart(open(), FILTER_VIEWS_TOOL, ['bauhof'], true));
    const file = compiled(doc);
    expect(toolAvailabilityFor(file, ['bauhof'], FILTER_VIEWS_TOOL)).toBe('active');
    expect(toolAvailabilityFor(file, ['kontrolle'], FILTER_VIEWS_TOOL)).toBeUndefined();
    const v = toolStartView(doc.effective(), FILTER_VIEWS_TOOL, 'de');
    expect(v.roles.map((r) => [r.key, r.state])).toEqual([
      ['kontrolle', 'none'],
      ['bauhof', 'active'],
      ['verwaltung', 'none'],
    ]);
  });

  it('off for a role that does not have the tool changes nothing (it is not granted)', () => {
    const before = open();
    const doc = must(setToolStart(before, CLUSTER_TOOL, null, false));
    expect(doc.overlay()).toEqual(before.overlay());
  });

  it('a role without an app list has every project tool, so "on" keeps it so and "off" lists the project tools', () => {
    let doc = open();
    doc = applyOne(doc, 'roles.freie', { label: { de: 'Freie' } });
    doc = applyOne(doc, 'tools.cluster', {});
    expect(toolAvailabilityFor(compiled(doc), ['freie'], CLUSTER_TOOL)).toBe('active');
    const off = must(setToolStart(doc, CLUSTER_TOOL, ['freie'], false));
    const file = compiled(off);
    expect(toolAvailabilityFor(file, ['freie'], CLUSTER_TOOL)).toBe('offered');
    // the other project tools stay active for that role, as before
    for (const t of ['measure', 'search', 'photo', 'draw'])
      expect(toolAvailabilityFor(file, ['freie'], t)).toBe('active');
    const on = must(setToolStart(off, CLUSTER_TOOL, ['freie'], true));
    expect(toolAvailabilityFor(compiled(on), ['freie'], CLUSTER_TOOL)).toBe('active');
  });

  it('refuses an unknown role', () => {
    expect(setToolStart(open(), CLUSTER_TOOL, ['gibt_es_nicht'], true)).toMatchObject({
      ok: false,
      code: 'refused',
    });
  });

  it('property: on then off then on for any role subset always ends active for exactly them', () => {
    fc.assert(
      fc.property(fc.subarray(roles(), { minLength: 1 }), (subset) => {
        let doc = must(setToolStart(open(), CLUSTER_TOOL, subset, true));
        doc = must(setToolStart(doc, CLUSTER_TOOL, subset, false));
        doc = must(setToolStart(doc, CLUSTER_TOOL, subset, true));
        const file = compiled(doc);
        for (const r of roles())
          expect(toolAvailabilityFor(file, [r], CLUSTER_TOOL)).toBe(
            subset.includes(r) ? 'active' : undefined,
          );
      }),
      { numRuns: 20 },
    );
  }, 30_000);
});
