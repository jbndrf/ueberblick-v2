import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { openProject, type Doc } from '@ueberblick/builder';
import { embedGoldenSource } from '@ueberblick/core/testing';
import {
  createRole,
  deleteRoles,
  isRoleName,
  listRoles,
  roleKeyOf,
  setQuota,
  updateRole,
  type RoleEdit,
} from './roles-doc';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
const open = (): Doc =>
  openProject(golden('templates/baumkataster/1.1.0.yaml'), golden('projects/musterstadt-baeume.yaml'));

const must = (r: RoleEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};

describe('listRoles', () => {
  it('lists the template roles with their label in the page language and where they come from', () => {
    const roles = listRoles(open(), 'de');
    expect(roles.find((r) => r.key === 'bauhof')).toEqual({
      key: 'bauhof',
      label: 'Bauhof',
      description: '',
      source: 'template',
      quota: 0,
      home: 'Meine Aufgaben',
    });
  });
});

describe('setQuota (WP-367): roles.<r>.quota in the draft, 0 removes the key', () => {
  it('sets, changes and removes the quota, and listRoles shows it', () => {
    const five = must(setQuota(open(), 'bauhof', 5));
    expect(five.effective().roles?.['bauhof']?.quota).toBe(5);
    expect(listRoles(five, 'de').find((r) => r.key === 'bauhof')?.quota).toBe(5);
    const seven = must(setQuota(five, 'bauhof', 7));
    expect(seven.effective().roles?.['bauhof']?.quota).toBe(7);
    const none = must(setQuota(seven, 'bauhof', 0));
    expect(none.effective().roles?.['bauhof']?.quota).toBeUndefined();
    expect(listRoles(none, 'de').find((r) => r.key === 'bauhof')?.quota).toBe(0);
  });

  it('0 on a role without a quota changes nothing', () => {
    const doc = open();
    expect(must(setQuota(doc, 'bauhof', 0))).toBe(doc);
  });

  it('refuses a negative, fractional or non-finite number and an unknown role', () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity])
      expect(setQuota(open(), 'bauhof', bad)).toMatchObject({ ok: false, code: 'quota_invalid' });
    expect(setQuota(open(), 'nix', 3)).toMatchObject({ ok: false, code: 'unknown_role' });
  });

  it('property: any non-negative integer round-trips (0 = absent)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), (n) => {
        const doc = must(setQuota(open(), 'bauhof', n));
        expect(doc.effective().roles?.['bauhof']?.quota).toBe(n === 0 ? undefined : n);
      }),
      { numRuns: 25 },
    );
  });
});

describe('createRole: name and description go into the draft overlay', () => {
  it('adds roles.<key> with the label and the description', () => {
    const doc = must(createRole(open(), { name: 'Gutachter', description: 'Prüft Meldungen' }));
    expect(doc.overlay().add?.['roles.gutachter']).toEqual({
      label: 'Gutachter',
      description: 'Prüft Meldungen',
    });
    expect(doc.dirty).toBe(true);
    expect(listRoles(doc, 'de').find((r) => r.key === 'gutachter')).toMatchObject({
      label: 'Gutachter',
      description: 'Prüft Meldungen',
      source: 'overlay',
    });
  });

  it('needs a name of two characters; the description is optional and left out when empty', () => {
    expect(createRole(open(), { name: ' a ' })).toMatchObject({ ok: false, code: 'name_short' });
    const doc = must(createRole(open(), { name: 'Leitung', description: '  ' }));
    expect(doc.overlay().add?.['roles.leitung']).toEqual({ label: 'Leitung' });
  });

  it('refuses a name that is shorter than two characters after trimming (v3), whitespace included', () => {
    const r = createRole(open(), { name: 'x ' });
    expect(r).toEqual({ ok: false, code: 'name_short' });
    expect(isRoleName('x ')).toBe(false);
    expect(isRoleName(' xy ')).toBe(true);
  });

  it('never reuses a key, whatever the names are (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 12 }).filter((n) => isRoleName(`x${n}`)),
          { minLength: 1, maxLength: 5 },
        ),
        (names) => {
          let doc = open();
          for (const name of names) {
            const r = createRole(doc, { name: `x${name}` });
            expect(r.ok).toBe(true);
            if (r.ok) doc = r.doc;
          }
          const keys = listRoles(doc, 'de').map((r) => r.key);
          expect(new Set(keys).size).toBe(keys.length);
          expect(keys.every((k) => /^[a-z][a-z0-9_]*$/.test(k))).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('roleKeyOf makes an ASCII key from German names', () => {
    expect(roleKeyOf('Prüfer & Größe')).toBe('pruefer_groesse');
    expect(roleKeyOf('2. Wahl')).toBe('r_2_wahl');
    expect(roleKeyOf('???')).toBe('rolle');
  });
});

describe('updateRole: rename and describe keep the key', () => {
  it('renames a template role in the page language only and adds a description', () => {
    const doc = must(updateRole(open(), 'bauhof', { name: 'Bauhof Nord', description: 'Pflege' }, 'de'));
    const role = listRoles(doc, 'de').find((r) => r.key === 'bauhof');
    expect(role).toMatchObject({ key: 'bauhof', label: 'Bauhof Nord', description: 'Pflege' });
    expect(listRoles(doc, 'en').find((r) => r.key === 'bauhof')?.label).toBe('Works yard');
  });

  it('edits a role the overlay added in place, and an empty description removes it', () => {
    let doc = must(createRole(open(), { name: 'Gutachter', description: 'a' }));
    doc = must(updateRole(doc, 'gutachter', { name: 'Gutachterin' }, 'de'));
    expect(doc.overlay().add?.['roles.gutachter']).toMatchObject({ label: 'Gutachterin', description: 'a' });
    doc = must(updateRole(doc, 'gutachter', { description: '' }, 'de'));
    expect(listRoles(doc, 'de').find((r) => r.key === 'gutachter')?.description).toBe('');
  });

  it('refuses an empty name and an unknown role; changing nothing returns the same doc', () => {
    expect(updateRole(open(), 'bauhof', { name: 'x' }, 'de')).toMatchObject({
      ok: false,
      code: 'name_short',
    });
    expect(updateRole(open(), 'nix', { name: 'a' }, 'de')).toMatchObject({ ok: false, code: 'unknown_role' });
    const doc = open();
    expect(must(updateRole(doc, 'bauhof', { name: 'Bauhof' }, 'de'))).toBe(doc);
  });
});

describe('deleteRoles: the Doc names what still uses the role', () => {
  it('drops a role the overlay added, with no uses', () => {
    const doc = must(createRole(open(), { name: 'Gutachter' }));
    const r = deleteRoles(doc, ['gutachter']);
    if ('refused' in r) throw new Error(r.refused);
    expect(listRoles(r.doc, 'de').some((x) => x.key === 'gutachter')).toBe(false);
    expect(r.uses).toEqual([]);
  });

  it('hides a template role, and lists the problems that come with it', () => {
    const r = deleteRoles(open(), ['bauhof']);
    if ('refused' in r) throw new Error(r.refused);
    expect(listRoles(r.doc, 'de').some((x) => x.key === 'bauhof')).toBe(false);
    expect(r.uses.length).toBeGreaterThan(0);
    expect(r.uses.every((p) => JSON.stringify(p).includes('bauhof'))).toBe(true);
  });

  it('refuses an unknown key', () => {
    expect(deleteRoles(open(), ['nix'])).toEqual({ refused: 'nix' });
  });
});
