import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { checkFilterPresets, compile, NO_ASSETS } from '@ueberblick/core';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { deletePreset, presetRows, savePreset } from './presets-doc';
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
const FILTER = { baum: "self.stage == 'kontrolliert'" };
const rows = (doc: Doc) => presetRows(doc.effective(), 'de', () => 1);
const compiledFile = (doc: Doc) => {
  const r = compile(doc.effective(), { assets: NO_ASSETS });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
};

describe('filter presets per role (v3 FieldFiltersSection presets, owner decision 3)', () => {
  it('has none to start with', () => {
    expect(rows(open())).toEqual([]);
  });

  it('a new preset for all roles is written to every role and shown as one row', () => {
    const roles = ['kontrolle', 'bauhof', 'verwaltung'];
    const doc = must(savePreset(open(), { name: 'Kontrollierte Bäume', roles, filters: FILTER }, 'de'));
    expect(doc.dirty).toBe(true);
    expect(rows(doc)).toEqual([
      { key: 'kontrollierte_baeume', label: 'Kontrollierte Bäume', roles, filters: FILTER, conditions: 1 },
    ]);
    for (const r of roles)
      expect(doc.effective().roles?.[r]?.app?.filter_presets?.['kontrollierte_baeume']).toEqual({
        label: 'Kontrollierte Bäume',
        filters: FILTER,
      });
  });

  it('compiles, and core type-checks the expression (the participant sees it in Ansichten)', () => {
    const doc = must(savePreset(open(), { name: 'A', roles: ['kontrolle'], filters: FILTER }, 'de'));
    expect(doc.problems()).toEqual(open().problems());
    expect(checkFilterPresets(compiledFile(doc).file)).toEqual([]);
  });

  it('needs a name and at least one role', () => {
    expect(savePreset(open(), { name: '  ', roles: ['kontrolle'], filters: FILTER }, 'de')).toMatchObject({
      ok: false,
      code: 'name_missing',
    });
    expect(savePreset(open(), { name: 'A', roles: [], filters: FILTER }, 'de')).toMatchObject({
      ok: false,
      code: 'roles_missing',
    });
    expect(savePreset(open(), { name: 'A', roles: ['nope'], filters: FILTER }, 'de')).toMatchObject({
      ok: false,
      code: 'refused',
    });
  });

  it('a second preset with the same name gets its own key', () => {
    let doc = must(savePreset(open(), { name: 'Gleich', roles: ['kontrolle'], filters: FILTER }, 'de'));
    doc = must(savePreset(doc, { name: 'Gleich', roles: ['kontrolle'], filters: { baum: 'true' } }, 'de'));
    expect(rows(doc).map((r) => r.key)).toEqual(['gleich', 'gleich_2']);
  });

  it('edits in place: new name and filter for the roles that stay, added and dropped roles follow', () => {
    let doc = must(
      savePreset(open(), { name: 'Alt', roles: ['kontrolle', 'bauhof'], filters: FILTER }, 'de'),
    );
    const [row] = rows(doc);
    expect(row?.roles).toEqual(['kontrolle', 'bauhof']);
    doc = must(
      savePreset(
        doc,
        {
          name: 'Neu',
          roles: ['bauhof', 'verwaltung'],
          filters: { baum: 'true' },
          key: row?.key ?? '',
          was: row?.roles ?? [],
        },
        'de',
      ),
    );
    expect(rows(doc)).toEqual([
      { key: 'alt', label: 'Neu', roles: ['bauhof', 'verwaltung'], filters: { baum: 'true' }, conditions: 1 },
    ]);
    expect(doc.effective().roles?.['kontrolle']?.app?.filter_presets).toEqual({});
  });

  it('keeps the other languages of a localized name', () => {
    let doc = open();
    const set = doc.apply({
      kind: 'set',
      path: 'roles.kontrolle.app.filter_presets',
      value: { x: { label: { de: 'Alt', en: 'Old' }, filters: FILTER } },
    });
    expect(set.refused).toBeUndefined();
    doc = set.doc;
    doc = must(
      savePreset(
        doc,
        { name: 'Neu', roles: ['kontrolle'], filters: FILTER, key: 'x', was: ['kontrolle'] },
        'de',
      ),
    );
    expect(doc.effective().roles?.['kontrolle']?.app?.filter_presets?.['x']?.label).toEqual({
      de: 'Neu',
      en: 'Old',
    });
  });

  it('refuses to overwrite another preset that has the same key in a role outside the edit', () => {
    let doc = open();
    for (const [role, expr] of [
      ['kontrolle', FILTER.baum],
      ['bauhof', 'true'],
    ] as const)
      doc = doc.apply({
        kind: 'set',
        path: `roles.${role}.app.filter_presets`,
        value: { x: { label: 'X', filters: { baum: expr } } },
      }).doc;
    expect(rows(doc)).toHaveLength(2); // same key, different filter: two rows
    const r = savePreset(
      doc,
      { name: 'X', roles: ['kontrolle', 'bauhof'], filters: FILTER, key: 'x', was: ['kontrolle'] },
      'de',
    );
    expect(r).toMatchObject({ ok: false, code: 'key_taken' });
  });

  it('delete removes the preset from every role that holds it, and only that one', () => {
    let doc = must(savePreset(open(), { name: 'A', roles: ['kontrolle', 'bauhof'], filters: FILTER }, 'de'));
    doc = must(savePreset(doc, { name: 'B', roles: ['kontrolle'], filters: { baum: 'true' } }, 'de'));
    doc = must(deletePreset(doc, { key: 'a', roles: ['kontrolle', 'bauhof'] }));
    expect(rows(doc).map((r) => r.key)).toEqual(['b']);
  });

  it('delete of a template preset hides it, and saving it again brings it back', () => {
    const source = parse(golden('templates/baumkataster/1.1.0.yaml')) as {
      roles: Record<string, { app: Record<string, unknown> }>;
    };
    const bauhof = source.roles['bauhof'];
    if (bauhof === undefined) throw new Error('no bauhof');
    bauhof.app['filter_presets'] = { vorgabe: { label: 'Vorgabe', filters: { baum: 'true' } } };
    const tpl = openProject(stringify(source), golden('projects/musterstadt-baeume.yaml'));
    expect(rows(tpl).map((r) => r.key)).toEqual(['vorgabe']);
    const gone = must(deletePreset(tpl, { key: 'vorgabe', roles: ['bauhof'] }));
    expect(rows(gone)).toEqual([]);
    const back = must(
      savePreset(
        gone,
        { name: 'Vorgabe', roles: ['bauhof'], filters: { baum: 'true' }, key: 'vorgabe', was: [] },
        'de',
      ),
    );
    expect(rows(back).map((r) => r.key)).toEqual(['vorgabe']);
  });

  it('property: any subset of roles reads back as one row holding exactly those roles', () => {
    fc.assert(
      fc.property(
        fc.subarray(['kontrolle', 'bauhof', 'verwaltung'], { minLength: 1 }),
        fc.stringMatching(/^[A-Za-zÄÖÜäöü][A-Za-z0-9 ]{0,12}$/),
        (roles, name) => {
          const doc = must(savePreset(open(), { name, roles, filters: FILTER }, 'de'));
          const [row, ...rest] = rows(doc);
          expect(rest).toEqual([]);
          expect([...(row?.roles ?? [])].sort()).toEqual([...roles].sort());
          expect(row?.label).toBe(name.trim());
        },
      ),
      { numRuns: 20 },
    );
  });
});
