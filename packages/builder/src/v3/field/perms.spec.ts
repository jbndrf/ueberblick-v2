import fc from 'fast-check';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { compile, compilePerms, NO_ASSETS, type TemplateFile } from '@ueberblick/core';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { propertyAudience, setPropertyAudienceOp, setPropertyRolesOp, PROPERTY_ACTIONS } from './perms';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
/** The golden project with the lookup type's permissions line taken out of the template. */
const openBare = (): Doc => {
  const template = parse(musterstadt.templateSrc) as { types: Record<string, { permissions?: unknown }> };
  delete template.types['baumart']?.permissions;
  return openProject(stringify(template), musterstadt.overlaySrc);
};

function apply(doc: Doc, op: ReturnType<typeof setPropertyRolesOp>): Doc {
  if (op === undefined) return doc;
  const r = doc.apply(op);
  expect(r.refused).toBeUndefined();
  return r.doc;
}

function typePerms(config: Parameters<typeof compilePerms>[0], type: string) {
  const tp = compilePerms(config).forType(type as never);
  if (tp === undefined) throw new Error(`no type ${type}`);
  return tp;
}

/** What the participant side sees: `core.perms` over the compiled draft (the same call the matrix and the server use). */
function readable(file: TemplateFile, type: string, role: string): ReadonlySet<string> {
  const c = compile(file, { assets: NO_ASSETS });
  if (!c.ok) throw new Error('draft does not compile');
  return typePerms(c.config, type).readable([`role:${role}`]);
}
function writable(file: TemplateFile, type: string, role: string): ReadonlySet<string> {
  const c = compile(file, { assets: NO_ASSETS });
  if (!c.ok) throw new Error('draft does not compile');
  return typePerms(c.config, type).writable([`role:${role}`]);
}

describe('propertyAudience reads the file the way core.perms means it', () => {
  it('a write map entry is its roles; an absent entry is nobody (denied)', () => {
    const file = open().effective();
    expect(propertyAudience(file, 'baum', 'write', 'hoehe_m')).toEqual({
      kind: 'roles',
      roles: ['kontrolle'],
    });
    expect(propertyAudience(file, 'baum', 'write', 'patenschaft')).toEqual({ kind: 'none' });
  });

  it('a see map: unlisted is every role that sees the row; a list is those roles', () => {
    const file = open().effective();
    expect(propertyAudience(file, 'baum', 'see', 'intern_notiz')).toEqual({
      kind: 'roles',
      roles: ['kontrolle', 'verwaltung'],
    });
    expect(propertyAudience(file, 'baum', 'see', 'hoehe_m')).toEqual({ kind: 'all' });
  });

  it('a whole-type $all is everyone; a whole-type list is those roles for write, and a row audience for see', () => {
    const file = open().effective();
    expect(propertyAudience(file, 'baumart', 'see', 'name_de')).toEqual({ kind: 'all' });
    expect(propertyAudience(file, 'baumart', 'write', 'name_de')).toEqual({
      kind: 'roles',
      roles: ['verwaltung'],
    });
  });

  it('a type without permissions: see is a row audience nobody holds; write is nobody', () => {
    const doc = openBare();
    const file = doc.effective();
    expect(propertyAudience(file, 'baumart', 'write', 'name_de')).toEqual({ kind: 'none' });
    expect(propertyAudience(file, 'baumart', 'see', 'name_de')).toEqual({ kind: 'row' });
  });
});

describe('setPropertyRolesOp writes permissions.see and permissions.write per property', () => {
  it('Sichtbar fuer = [kontrolle] hides the property from every other role (acceptance 2)', () => {
    const doc = apply(
      open(),
      setPropertyRolesOp(open().effective(), 'baum', 'see', 'hoehe_m', ['kontrolle']),
    );
    const file = doc.effective();
    expect(file.types?.['baum']?.permissions?.see).toMatchObject({ hoehe_m: ['kontrolle'] });
    expect(readable(file, 'baum', 'kontrolle').has('hoehe_m')).toBe(true);
    expect(readable(file, 'baum', 'bauhof').has('hoehe_m')).toBe(false);
    expect(readable(file, 'baum', 'verwaltung').has('hoehe_m')).toBe(false);
    // the other entries of the map survive
    expect(readable(file, 'baum', 'verwaltung').has('intern_notiz')).toBe(true);
    expect(doc.problems().filter((p) => p.path.startsWith('types.baum.permissions'))).toEqual([]);
  });

  it('empty see removes the entry: everyone who sees the row sees the property again', () => {
    const doc = apply(open(), setPropertyRolesOp(open().effective(), 'baum', 'see', 'intern_notiz', []));
    expect(doc.effective().types?.['baum']?.permissions?.see).toEqual({});
    expect(readable(doc.effective(), 'baum', 'bauhof').has('intern_notiz')).toBe(true);
  });

  it('Bearbeitbar fuer = [kontrolle, bauhof] writes the list; empty writes $all (leer = alle)', () => {
    let doc = apply(
      open(),
      setPropertyRolesOp(open().effective(), 'baum', 'write', 'hoehe_m', ['kontrolle', 'bauhof']),
    );
    expect(doc.effective().types?.['baum']?.permissions?.write).toMatchObject({
      hoehe_m: ['kontrolle', 'bauhof'],
    });
    expect(writable(doc.effective(), 'baum', 'bauhof').has('hoehe_m')).toBe(true);
    doc = apply(doc, setPropertyRolesOp(doc.effective(), 'baum', 'write', 'hoehe_m', []));
    expect(doc.effective().types?.['baum']?.permissions?.write).toMatchObject({ hoehe_m: '$all' });
    expect(writable(doc.effective(), 'baum', 'verwaltung').has('hoehe_m')).toBe(true);
  });

  it('a whole-type audience becomes a map: the other properties keep their audience', () => {
    const before = open().effective();
    const doc = apply(open(), setPropertyRolesOp(before, 'baumart', 'write', 'name_lat', ['kontrolle']));
    const after = doc.effective();
    expect(writable(after, 'baumart', 'verwaltung').has('name_de')).toBe(true);
    expect(writable(after, 'baumart', 'verwaltung').has('name_lat')).toBe(false);
    expect(writable(after, 'baumart', 'kontrolle').has('name_lat')).toBe(true);
    // $all see turns into a map and everyone still sees every property
    const seen = apply(open(), setPropertyRolesOp(before, 'baumart', 'see', 'name_lat', ['verwaltung']));
    expect(readable(seen.effective(), 'baumart', 'bauhof').has('name_de')).toBe(true);
    expect(readable(seen.effective(), 'baumart', 'bauhof').has('name_lat')).toBe(false);
  });

  it('refuses to turn a row audience into a map (that would show the row to everyone)', () => {
    const file = openBare().effective();
    expect(setPropertyRolesOp(file, 'baumart', 'see', 'name_de', ['kontrolle'])).toBeUndefined();
  });

  it('a type without permissions gets the map added for write', () => {
    const doc = openBare();
    const next = apply(
      doc,
      setPropertyRolesOp(doc.effective(), 'baumart', 'write', 'name_de', ['verwaltung']),
    );
    expect(writable(next.effective(), 'baumart', 'verwaltung').has('name_de')).toBe(true);
  });

  it('is a no-op (undefined) when the property already has that audience', () => {
    const file = open().effective();
    expect(setPropertyRolesOp(file, 'baum', 'write', 'hoehe_m', ['kontrolle'])).toBeUndefined();
    expect(setPropertyRolesOp(file, 'baum', 'see', 'hoehe_m', [])).toBeUndefined();
  });

  it('property: whatever role set is written is read back, and no other property changes', () => {
    const roles = ['kontrolle', 'bauhof', 'verwaltung'];
    fc.assert(
      fc.property(
        fc.constantFrom(...PROPERTY_ACTIONS),
        fc.constantFrom('hoehe_m', 'intern_notiz', 'befund', 'faellig_am'),
        fc.subarray(roles),
        (action, prop, picked) => {
          const doc0 = open();
          const file0 = doc0.effective();
          const doc = apply(doc0, setPropertyRolesOp(file0, 'baum', action, prop, picked));
          const file = doc.effective();
          const back = propertyAudience(file, 'baum', action, prop);
          if (picked.length > 0) expect(back).toEqual({ kind: 'roles', roles: picked });
          else expect(back).toEqual({ kind: 'all' });
          for (const other of Object.keys(file0.types?.['baum']?.properties ?? {})) {
            if (other === prop) continue;
            expect(propertyAudience(file, 'baum', action, other)).toEqual(
              propertyAudience(file0, 'baum', action, other),
            );
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('setPropertyAudienceOp', () => {
  it('none writes an empty list for see and for write', () => {
    for (const action of PROPERTY_ACTIONS) {
      const file = open().effective();
      const doc = apply(open(), setPropertyAudienceOp(file, 'baum', action, 'hoehe_m', { kind: 'none' }));
      const map = doc.effective().types?.['baum']?.permissions?.[action] as Record<string, unknown>;
      expect(map['hoehe_m']).toEqual([]);
      expect(propertyAudience(doc.effective(), 'baum', action, 'hoehe_m')).toEqual({ kind: 'none' });
    }
    const see = apply(
      open(),
      setPropertyAudienceOp(open().effective(), 'baum', 'see', 'hoehe_m', { kind: 'none' }),
    ).effective();
    expect(readable(see, 'baum', 'kontrolle').has('hoehe_m')).toBe(false);
  });

  it('is a no-op when the property already has that audience', () => {
    const file = open().effective();
    expect(propertyAudience(file, 'baum', 'write', 'patenschaft')).toEqual({ kind: 'none' });
    expect(setPropertyAudienceOp(file, 'baum', 'write', 'patenschaft', { kind: 'none' })).toBeUndefined();
    const none = apply(open(), setPropertyAudienceOp(file, 'baum', 'see', 'hoehe_m', { kind: 'none' }));
    expect(
      setPropertyAudienceOp(none.effective(), 'baum', 'see', 'hoehe_m', { kind: 'none' }),
    ).toBeUndefined();
  });

  it('setPropertyRolesOp is the same op for a role list and "all" for an empty list', () => {
    const file = open().effective();
    expect(setPropertyRolesOp(file, 'baum', 'write', 'hoehe_m', ['bauhof'])).toEqual(
      setPropertyAudienceOp(file, 'baum', 'write', 'hoehe_m', { kind: 'roles', roles: ['bauhof'] }),
    );
    expect(setPropertyRolesOp(file, 'baum', 'write', 'hoehe_m', [])).toEqual(
      setPropertyAudienceOp(file, 'baum', 'write', 'hoehe_m', { kind: 'all' }),
    );
  });
});
