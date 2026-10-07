import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { infoPageRows } from '../../../../../../lib/admin/settings/info-pages';
import { packRows, type PackValues } from '../../../../../../lib/admin/settings/packs';
import {
  deleteInfoPage,
  deletePack,
  setInfoPage,
  setPack,
  setPackRoles,
  uniqueKey,
} from './settings-entries';
import type { SettingsEdit } from './settings-doc';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
// the template ships two info pages (willkommen, kontakt), one layer (osm) and three roles, and no pack
const open = (): Doc =>
  openProject(golden('templates/baumkataster/1.1.0.yaml'), golden('projects/musterstadt-baeume.yaml'));
const must = (r: SettingsEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const rows = (doc: Doc) => infoPageRows(doc.effective(), 'de');
const PACK: PackValues = {
  name: 'Innenstadt',
  minZoom: 12,
  maxZoom: 14,
  bounds: [7.08, 50.7, 7.14, 50.75],
  layers: ['osm'],
  roles: [],
};

describe('info pages go into the draft overlay', () => {
  it('creates a page with a key from the title, sorted by its order, and leaves the template ones alone', () => {
    const doc = must(
      setInfoPage(open(), { title: 'Datenschutz & Co', content: '<p>x</p>', sortOrder: 0 }, 'de'),
    );
    expect(doc.dirty).toBe(true);
    expect(rows(doc).map((r) => [r.key, r.title, r.sortOrder])).toEqual([
      ['datenschutz_co', 'Datenschutz & Co', 0],
      ['willkommen', 'Willkommen', 1],
      ['kontakt', 'Kontakt', 2],
    ]);
    expect(doc.provenance('info_pages.datenschutz_co')).toBe('added');
  });
  it('a second page with the same title gets a new key', () => {
    let doc = must(setInfoPage(open(), { title: 'Hilfe', content: 'a', sortOrder: 5 }, 'de'));
    doc = must(setInfoPage(doc, { title: 'Hilfe', content: 'b', sortOrder: 6 }, 'de'));
    expect(rows(doc).map((r) => r.key)).toEqual(expect.arrayContaining(['hilfe', 'hilfe_2']));
  });
  it('edits a template page: the page language entry changes, the other one stays (override)', () => {
    const doc = must(
      setInfoPage(open(), { key: 'willkommen', title: 'Hallo', content: '<p>neu</p>', sortOrder: 9 }, 'de'),
    );
    const page = doc.effective().info_pages?.['willkommen'];
    expect(page?.title).toEqual({ de: 'Hallo', en: 'Welcome' });
    expect((page?.content as { de: string; en: string }).en).toContain('record');
    expect(page?.sort_order).toBe(9);
    expect(rows(doc).map((r) => r.key)).toEqual(['kontakt', 'willkommen']);
    expect(doc.provenance('info_pages.willkommen')).not.toBe('template');
  });
  it('deletes an added page (reset) and hides a template page', () => {
    let doc = must(setInfoPage(open(), { title: 'Neu', content: 'x', sortOrder: 3 }, 'de'));
    doc = must(deleteInfoPage(doc, 'neu'));
    expect(rows(doc).map((r) => r.key)).toEqual(['willkommen', 'kontakt']);
    doc = must(deleteInfoPage(doc, 'willkommen'));
    expect(rows(doc).map((r) => r.key)).toEqual(['kontakt']);
    expect(doc.overlay().hide).toContain('info_pages.willkommen');
  });
  it('an unknown page is not_found, for edit and delete', () => {
    expect(setInfoPage(open(), { key: 'nope', title: 'x', content: 'y', sortOrder: 0 }, 'de')).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(deleteInfoPage(open(), 'nope')).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('offline packs go into the draft overlay', () => {
  it('creates the first pack (the file has none) and a second one, each with a key from its name', () => {
    let doc = must(setPack(open(), PACK, 'de'));
    expect(packRows(doc.effective(), 'de')).toMatchObject([
      {
        key: 'innenstadt',
        name: 'Innenstadt',
        bounds: [7.08, 50.7, 7.14, 50.75],
        minZoom: 12,
        maxZoom: 14,
        layers: ['osm'],
      },
    ]);
    expect(doc.effective().map?.packs?.['innenstadt']).not.toHaveProperty('roles');
    doc = must(setPack(doc, { ...PACK, name: 'Innenstadt', roles: ['kontrolle'] }, 'de'));
    expect(packRows(doc.effective(), 'de').map((p) => [p.key, p.roles])).toEqual([
      ['innenstadt', []],
      ['innenstadt_2', ['kontrolle']],
    ]);
    expect(doc.problems().filter((p) => p.code.startsWith('pack_'))).toEqual([]);
  });
  it('edits a pack in place and keeps its key', () => {
    let doc = must(setPack(open(), PACK, 'de'));
    doc = must(setPack(doc, { ...PACK, key: 'innenstadt', name: 'Zentrum', maxZoom: 15 }, 'de'));
    expect(packRows(doc.effective(), 'de')).toMatchObject([
      { key: 'innenstadt', name: 'Zentrum', maxZoom: 15 },
    ]);
  });
  it('the inline roles column sets and clears the audience, and nothing else changes', () => {
    let doc = must(setPack(open(), PACK, 'de'));
    doc = must(setPackRoles(doc, 'innenstadt', ['kontrolle', 'bauhof']));
    expect(doc.effective().map?.packs?.['innenstadt']?.roles).toEqual(['kontrolle', 'bauhof']);
    doc = must(setPackRoles(doc, 'innenstadt', []));
    expect(doc.effective().map?.packs?.['innenstadt']).not.toHaveProperty('roles');
    expect(packRows(doc.effective(), 'de')[0]).toMatchObject({ name: 'Innenstadt', maxZoom: 14 });
  });
  it('delete removes the pack; an unknown key is not_found', () => {
    let doc = must(setPack(open(), PACK, 'de'));
    doc = must(deletePack(doc, 'innenstadt'));
    expect(packRows(doc.effective(), 'de')).toEqual([]);
    expect(deletePack(doc, 'innenstadt')).toEqual({ ok: false, code: 'not_found' });
    expect(setPackRoles(doc, 'innenstadt', [])).toEqual({ ok: false, code: 'not_found' });
    expect(setPack(doc, { ...PACK, key: 'innenstadt' }, 'de')).toEqual({ ok: false, code: 'not_found' });
  });
  it('a pack naming a role that does not exist is a compile problem, so the publish bar blocks it', () => {
    const doc = must(setPack(open(), { ...PACK, roles: ['gibtsnicht'] }, 'de'));
    expect(doc.problems().map((p) => p.code)).toContain('pack_unknown_role');
  });
});

describe('uniqueKey', () => {
  it('property: never returns a taken key, and keeps a free one', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'a_2', 'a_3', 'b'), { maxLength: 4 }), (taken) => {
        const k = uniqueKey('a', taken);
        expect(taken).not.toContain(k);
        if (!taken.includes('a')) expect(k).toBe('a');
      }),
    );
  });
});
