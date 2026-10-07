// WP-397 (A-040): Erststart "Sichtbare Objektarten" on the draft: on_at_start and values_at_start, read back, compiled,
// and the participant's start state (core `startFilter`) follows.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { compile, NO_ASSETS, startFilter } from '@ueberblick/core';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { setStartup, startupView } from './start-doc';
import { setStartTypes, startTypesView } from './start-visible-doc';
import type { SettingsEdit } from './settings-doc';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
const open = (): Doc =>
  openProject(golden('templates/baumkataster/1.1.0.yaml'), golden('projects/musterstadt-baeume.yaml'));
const must = (r: SettingsEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const STAGES = ['erfasst', 'kontrolliert', 'massnahme', 'erledigt'];
const compiled = (doc: Doc) => {
  const r = compile(doc.effective(), { assets: NO_ASSETS });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config.file;
};

describe('Erststart: Sichtbare Objektarten (v3 Sichtbare Workflows)', () => {
  it('lists the Objektarten that have a place on the map, with their values, all on by default', () => {
    const types = startTypesView(open().effective(), 'de');
    expect(types.map((t) => t.key)).toEqual(['flaeche', 'baum']);
    const baum = types.find((t) => t.key === 'baum');
    expect(baum?.on).toBe(true);
    expect(baum?.mode).toBe('stage');
    expect(baum?.values.map((v) => [v.value, v.on])).toEqual(STAGES.map((s) => [s, true]));
    expect(baum?.values[0]?.label).toBe('Erfasst');
    expect(types.find((t) => t.key === 'flaeche')?.values).toEqual([]);
    expect(startupView(open().effective(), 'de').types).toEqual(types);
  });

  it('unticking a type writes on_at_start: false, reads back, compiles and starts the filter without it', () => {
    const doc = must(setStartTypes(open(), { baum: { on: false, values: null } }));
    expect(doc.problems()).toEqual(open().problems());
    expect(compiled(doc).types?.['baum']?.on_at_start).toBe(false);
    expect(startTypesView(doc.effective(), 'de').find((t) => t.key === 'baum')?.on).toBe(false);
    expect([...startFilter(compiled(doc)).hiddenTypes]).toEqual(['baum']);
  });

  it('unticking values writes values_at_start in declaration order, and reads back', () => {
    const doc = must(setStartTypes(open(), { baum: { on: true, values: ['massnahme', 'erfasst'] } }));
    expect(compiled(doc).types?.['baum']?.values_at_start).toEqual(['erfasst', 'massnahme']);
    const v = startTypesView(doc.effective(), 'de').find((t) => t.key === 'baum');
    expect(v?.values.filter((x) => x.on).map((x) => x.value)).toEqual(['erfasst', 'massnahme']);
    const s = startFilter(compiled(doc));
    expect([...(s.hiddenValues.get('baum' as never) ?? [])]).toEqual(['kontrolliert', 'erledigt']);
    expect(s.hiddenTypes.size).toBe(0);
  });

  it('all values ticked, or a type ticked again, removes the keys: the file is as before', () => {
    const changed = must(setStartTypes(open(), { baum: { on: false, values: ['erfasst'] } }));
    const back = must(setStartTypes(changed, { baum: { on: true, values: null } }));
    expect(compiled(back).types?.['baum']?.values_at_start).toBeUndefined();
    expect(startFilter(compiled(back)).hiddenValues.size).toBe(0);
    const all = must(setStartTypes(changed, { baum: { on: true, values: STAGES } }));
    expect(compiled(all).types?.['baum']?.values_at_start).toBeUndefined();
  });

  it('writes nothing when nothing changes, and leaves a type that is not listed alone', () => {
    const before = open();
    expect(must(setStartTypes(before, { baum: { on: true, values: null } })).overlay()).toEqual(
      before.overlay(),
    );
    expect(must(setStartTypes(before, {})).overlay()).toEqual(before.overlay());
  });

  it('refuses an unknown type, a type with no place on the map, an unknown value and values of a type without any', () => {
    const bad = (types: Parameters<typeof setStartTypes>[1]) => setStartTypes(open(), types);
    expect(bad({ nix: { on: true, values: null } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(bad({ baumart: { on: false, values: null } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(bad({ baum: { on: true, values: ['zz'] } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(bad({ flaeche: { on: true, values: ['a'] } })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('setStartup writes the layers and the Objektarten in one save', () => {
    const doc = must(
      setStartup(open(), { base: null, overlays: [], types: { baum: { on: true, values: ['erfasst'] } } }),
    );
    expect(compiled(doc).types?.['baum']?.values_at_start).toEqual(['erfasst']);
  });

  it('property: any on flag and value subset reads back and starts the filter exactly so', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.subarray(STAGES), (on, values) => {
        const doc = must(setStartTypes(open(), { baum: { on, values } }));
        const file = compiled(doc);
        const v = startTypesView(doc.effective(), 'de').find((t) => t.key === 'baum');
        expect(v?.on).toBe(on);
        expect(v?.values.filter((x) => x.on).map((x) => x.value)).toEqual(
          STAGES.filter((s) => values.includes(s)),
        );
        const s = startFilter(file);
        expect(s.hiddenTypes.has('baum' as never)).toBe(!on || values.length === 0);
      }),
      { numRuns: 25 },
    );
  }, 30_000);
});
