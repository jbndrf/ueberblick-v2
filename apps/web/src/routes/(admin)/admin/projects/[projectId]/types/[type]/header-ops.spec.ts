// WP-418: the data page header's edits are builder Doc ops on the draft (S3-19). Name, description, "Sichtbar für Rollen",
// "Private Einträge" and the shape pills; the roles and private ops are the permission matrix's own (R1).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openProject, permissionCellOp, privateOp, type Doc } from '@ueberblick/builder';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { HEADER_PRIVATE } from '../../../../../../../lib/admin/data/header-types';
import { headerEdit, headerState } from './header-ops';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
const open = (): Doc =>
  openProject(golden('templates/baumkataster/1.1.0.yaml'), golden('projects/musterstadt-baeume.yaml'));
const must = (r: ReturnType<typeof headerEdit>): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const def = (d: Doc, key: string) => d.effective().types?.[key];

describe('name and description', () => {
  it('write the label and the description of the page language, keeping the other language', () => {
    const d = must(headerEdit(open(), 'flaeche', { action: 'name', value: ' Grünfläche ' }, 'de'));
    expect(def(d, 'flaeche')?.label).toEqual({ de: 'Grünfläche', en: 'Area' });
    const e = must(headerEdit(d, 'flaeche', { action: 'description', value: 'Alle Flächen' }, 'de'));
    expect(def(e, 'flaeche')?.description).toEqual({ de: 'Alle Flächen' });
  });
  it('refuse an empty name', () => {
    expect(headerEdit(open(), 'flaeche', { action: 'name', value: '  ' }, 'de')).toMatchObject({
      ok: false,
      code: 'name_empty',
    });
  });
  it('refuse an unknown type', () => {
    expect(headerEdit(open(), 'nix', { action: 'name', value: 'X' }, 'de')).toMatchObject({
      ok: false,
      code: 'unknown_type',
    });
  });
});

describe('roles ("Sichtbar für Rollen")', () => {
  it('writes the op of the permission matrix for the same audience', () => {
    const doc = open();
    const expected = permissionCellOp(
      doc.effective(),
      'flaeche',
      { action: 'see' },
      { kind: 'roles', roles: ['verwaltung', 'kontrolle'] },
    );
    if (expected === undefined) throw new Error('no op');
    const viaMatrix = doc.apply(expected).doc;
    const viaHeader = must(
      headerEdit(doc, 'flaeche', { action: 'roles', roles: ['verwaltung', 'kontrolle'] }, 'de'),
    );
    expect(def(viaHeader, 'flaeche')?.permissions).toEqual(def(viaMatrix, 'flaeche')?.permissions);
    expect(def(viaHeader, 'flaeche')?.permissions?.see).toEqual(['verwaltung', 'kontrolle']);
  });
  it('an empty list means every role (v3: Alle)', () => {
    const d = must(headerEdit(open(), 'flaeche', { action: 'roles', roles: ['verwaltung'] }, 'de'));
    const e = must(headerEdit(d, 'flaeche', { action: 'roles', roles: [] }, 'de'));
    expect(def(e, 'flaeche')?.permissions?.see).toBe('$all');
  });
  it('is refused where the file keys `see` by property (the matrix edits that)', () => {
    expect(headerEdit(open(), 'baum', { action: 'roles', roles: ['verwaltung'] }, 'de')).toMatchObject({
      ok: false,
      code: 'locked',
    });
  });
});

describe('"Private Einträge"', () => {
  it("on and off are privateOp, and the states are the builder's", () => {
    const doc = open();
    const op = privateOp(doc, 'flaeche', true);
    if (op === undefined) throw new Error('no op');
    const on = must(headerEdit(doc, 'flaeche', { action: 'private', on: true }, 'de'));
    expect(def(on, 'flaeche')?.permissions).toEqual(def(doc.apply(op).doc, 'flaeche')?.permissions);
    expect(headerState(on, 'flaeche', 'de', 0).private).toBe('on');
    const off = must(headerEdit(on, 'flaeche', { action: 'private', on: false }, 'de'));
    expect(headerState(off, 'flaeche', 'de', 0).private).toBe('off');
    expect(HEADER_PRIVATE).toEqual(['off', 'on', 'custom']);
  });
  it('never overwrites a custom condition', () => {
    const doc = must(headerEdit(open(), 'flaeche', { action: 'private', on: true }, 'de'));
    const custom = doc.apply({
      kind: 'set',
      path: 'types.flaeche.permissions.visible_when',
      value: 'self.name == "x"',
    }).doc;
    const state = headerState(custom, 'flaeche', 'de', 0);
    expect(state.private).toBe('custom');
    expect(state.privateWhen).toBe('self.name == "x"');
    expect(headerEdit(custom, 'flaeche', { action: 'private', on: false }, 'de')).toMatchObject({
      ok: false,
      code: 'locked',
    });
  });
});

describe('shape pills', () => {
  it('reads map or form, and the kind', () => {
    expect(headerState(open(), 'baum', 'de', 3).shape).toEqual({ map: true, kind: 'point' });
    expect(headerState(open(), 'flaeche', 'de', 0).shape).toEqual({ map: true, kind: 'polygon' });
    expect(headerState(open(), 'massnahme', 'de', 0).shape).toEqual({ map: false });
  });
  it('changes the geometry kind in the draft, with objects present too (the deploy overview shows them)', () => {
    const d = must(headerEdit(open(), 'baum', { action: 'geometry', kind: 'polygon' }, 'de'));
    expect(def(d, 'baum')?.properties['geometrie']).toMatchObject({
      type: 'geometry',
      geometry_type: 'polygon',
    });
    expect(headerState(d, 'baum', 'de', 7)).toMatchObject({
      featureCount: 7,
      shape: { map: true, kind: 'polygon' },
    });
  });
  it("form to map adds a geometry property and makes it the type's geometry", () => {
    const d = must(headerEdit(open(), 'massnahme', { action: 'map', on: true }, 'de'));
    const geometry = def(d, 'massnahme')?.geometry;
    expect(geometry).toBeTypeOf('string');
    expect(def(d, 'massnahme')?.properties[geometry as string]).toMatchObject({
      type: 'geometry',
      geometry_type: 'point',
    });
    expect(headerState(d, 'massnahme', 'de', 0).shape).toEqual({ map: true, kind: 'point' });
  });
  it("map to form drops the type's geometry and keeps the property", () => {
    const d = must(headerEdit(open(), 'flaeche', { action: 'map', on: false }, 'de'));
    expect(def(d, 'flaeche')?.geometry).toBeUndefined();
    expect(def(d, 'flaeche')?.properties['geometrie']).toBeDefined();
    expect(headerState(d, 'flaeche', 'de', 0).shape).toEqual({ map: false });
  });
  it('a kind cannot be set on a form', () => {
    expect(headerEdit(open(), 'massnahme', { action: 'geometry', kind: 'point' }, 'de')).toMatchObject({
      ok: false,
      code: 'no_geometry',
    });
  });
});

describe('headerState', () => {
  it('reads the audience and the roles in the page language', () => {
    const s = headerState(open(), 'flaeche', 'de', 0);
    expect(s.audience).toEqual({ kind: 'all' });
    expect(s.roles.map((r) => r.key)).toContain('verwaltung');
    expect(headerState(open(), 'baum', 'de', 0).audience).toEqual({ kind: 'property' });
  });
});
