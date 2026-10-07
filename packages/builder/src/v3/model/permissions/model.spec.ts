import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compile, compilePerms, NO_ASSETS, roleSubject, type Key } from '@ueberblick/core';
import { openProject, type Doc } from '../../../doc';
import { buildMatrix } from '../../../lenses/roles/model';
import { messages } from '../../../shell/messages';
import { musterstadt } from '../../../testing/golden';
import { buildPermissionModel, toggledAudience, type MatrixRowModel } from './model';
import { cellOp, privateOp, PRIVATE_WHEN, privateState, resetOp, toggleOp } from './ops';

const t = messages('de');
const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const ROLES = ['kontrolle', 'bauhof', 'verwaltung'];

function need<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value');
  return v;
}
const rows = (doc: Doc, type: string): MatrixRowModel[] =>
  buildPermissionModel(doc, type, 'de', t).sections.flatMap((s) => s.bands.flatMap((b) => b.rows));
const rowOf = (doc: Doc, type: string, id: string): MatrixRowModel =>
  need(rows(doc, type).find((r) => r.id === id));
const allowed = (r: MatrixRowModel, role: string): boolean | undefined =>
  r.cells.find((c) => c.role === role)?.allowed;

function apply(doc: Doc, op: ReturnType<typeof toggleOp>): Doc {
  const o = need(op);
  const r = doc.apply(o);
  expect(r.refused).toBeUndefined();
  return r.doc;
}
function perms(doc: Doc, type: string) {
  const c = compile(doc.effective(), { assets: NO_ASSETS });
  if (!c.ok) throw new Error('draft does not compile');
  return need(compilePerms(c.config).forType(type as Key));
}

describe('the model reads what buildMatrix reads (acceptance 1)', () => {
  it('has the roles as columns, in file order, with their labels', () => {
    const m = buildPermissionModel(open(), 'baum', 'de', t);
    expect(m.available).toBe(true);
    expect(m.roles.map((r) => r.key)).toEqual(ROLES);
    expect(m.roles.map((r) => r.label)).toEqual(['Baumkontrolle', 'Bauhof', 'Verwaltung']);
  });

  it('sections: Sehen, Erstellen/Löschen (Erweitert), then one read and one write row per property', () => {
    const m = buildPermissionModel(open(), 'baum', 'de', t);
    expect(m.sections.map((s) => s.id)).toEqual(['visibility', 'capabilities', 'fields']);
    const caps = need(m.sections[1]);
    expect(caps.bands.every((b) => b.advanced)).toBe(true);
    const ids = rows(open(), 'baum').map((r) => r.id);
    expect(ids).toContain('baum.see');
    expect(ids).toContain('baum.create');
    expect(ids).toContain('baum.delete');
    expect(ids).toContain('baum.see.hoehe_m');
    expect(ids).toContain('baum.write.hoehe_m');
    const props = Object.keys(open().effective().types?.['baum']?.properties ?? {});
    expect(ids.filter((i) => i.startsWith('baum.write.'))).toHaveLength(props.length);
  });

  it('every cell equals the matrix lens (and so core.perms) for every type', () => {
    const doc = open();
    const lens = buildMatrix(doc, 'de');
    let checked = 0;
    for (const type of lens.types) {
      for (const lr of [...type.rows, ...type.propertyRows]) {
        const mine = rows(doc, type.key).find((r) => r.id === lr.id);
        if (mine === undefined) continue; // the whole-type write row is not in v3's matrix
        for (const c of lr.cells) {
          expect(allowed(mine, c.subject.slice(5)), `${lr.id} ${c.subject}`).toBe(c.allowed);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('a role list as the type audience locks every property read; a see map locks the type row', () => {
    const list = need(
      open().apply({ kind: 'set', path: 'types.massnahme.permissions.see', value: ['kontrolle'] }).doc,
    );
    expect(rowOf(list, 'massnahme', 'massnahme.see.art').locked).toBe('row');
    expect(rowOf(list, 'massnahme', 'massnahme.see').locked).toBeUndefined();
    const doc = open();
    expect(rowOf(doc, 'massnahme', 'massnahme.see.art').locked).toBeUndefined();
    expect(rowOf(doc, 'baum', 'baum.see').locked).toBe('all_rows_visible');
    expect(rowOf(doc, 'baum', 'baum.see.intern_notiz').locked).toBeUndefined();
  });

  it('reports an unavailable matrix when the draft does not compile', () => {
    const doc = need(
      open().apply({ kind: 'set', path: 'types.baum.properties.art.to', value: 'gibt_es_nicht' }).doc,
    );
    expect(buildPermissionModel(doc, 'baum', 'de', t).available).toBe(false);
  });
});

describe('toggling a cell applies the right op (acceptance 2)', () => {
  it('property write: turning a role on adds it to the list, off removes it', () => {
    let doc = open();
    const row = rowOf(doc, 'baum', 'baum.write.hoehe_m');
    expect(allowed(row, 'bauhof')).toBe(false);
    doc = apply(doc, toggleOp(doc, 'baum', row, 'bauhof', ROLES));
    expect(perms(doc, 'baum').canWrite([roleSubject('bauhof')], ['hoehe_m']).ok).toBe(true);
    expect(perms(doc, 'baum').canWrite([roleSubject('kontrolle')], ['hoehe_m']).ok).toBe(true);
    const again = rowOf(doc, 'baum', 'baum.write.hoehe_m');
    doc = apply(doc, toggleOp(doc, 'baum', again, 'kontrolle', ROLES));
    expect(perms(doc, 'baum').canWrite([roleSubject('kontrolle')], ['hoehe_m']).ok).toBe(false);
    expect(perms(doc, 'baum').canWrite([roleSubject('bauhof')], ['hoehe_m']).ok).toBe(true);
  });

  it('turning the last role off leaves nobody (not everybody)', () => {
    let doc = open();
    doc = apply(doc, toggleOp(doc, 'baum', rowOf(doc, 'baum', 'baum.write.hoehe_m'), 'kontrolle', ROLES));
    const p = perms(doc, 'baum');
    for (const r of ROLES) expect(p.canWrite([roleSubject(r)], ['hoehe_m']).ok).toBe(false);
    const row = rowOf(doc, 'baum', 'baum.write.hoehe_m');
    expect(row.audience).toEqual({ kind: 'none' });
    for (const r of ROLES) expect(allowed(row, r)).toBe(false);
  });

  it('turning every role on makes the audience $all (v3: empty = all)', () => {
    let doc = open();
    for (const role of ['bauhof', 'verwaltung']) {
      doc = apply(doc, toggleOp(doc, 'baum', rowOf(doc, 'baum', 'baum.write.hoehe_m'), role, ROLES));
    }
    expect(rowOf(doc, 'baum', 'baum.write.hoehe_m').audience).toEqual({ kind: 'all' });
  });

  it('turning one role off an $all audience keeps the others', () => {
    let doc = open();
    const key = 'baum.write.hoehe_m';
    for (const role of ['bauhof', 'verwaltung']) {
      doc = apply(doc, toggleOp(doc, 'baum', rowOf(doc, 'baum', key), role, ROLES));
    }
    doc = apply(doc, toggleOp(doc, 'baum', rowOf(doc, 'baum', key), 'bauhof', ROLES));
    expect(rowOf(doc, 'baum', key).audience).toEqual({ kind: 'roles', roles: ['kontrolle', 'verwaltung'] });
  });

  it('the type-level rows: Sehen, Erstellen and Löschen', () => {
    let doc = open();
    const see = rowOf(doc, 'massnahme', 'massnahme.see');
    expect(see.audience).toEqual({ kind: 'all' });
    doc = apply(doc, toggleOp(doc, 'massnahme', see, 'bauhof', ROLES));
    const p = perms(doc, 'massnahme');
    expect(
      p.seeSql(
        [roleSubject('bauhof')],
        { id: 'a', kind: 'admin', roles: ['bauhof' as Key] },
        'f',
        '1970-01-01T00:00:00.000Z',
      ).kind,
    ).toBe('none');
    expect(
      p.seeSql(
        [roleSubject('verwaltung')],
        { id: 'a', kind: 'admin', roles: ['verwaltung' as Key] },
        'f',
        '1970-01-01T00:00:00.000Z',
      ).kind,
    ).not.toBe('none');

    const create = rowOf(doc, 'massnahme', 'massnahme.create');
    doc = apply(doc, toggleOp(doc, 'massnahme', create, 'bauhof', ROLES));
    expect(perms(doc, 'massnahme').canCreate([roleSubject('bauhof')]).ok).toBe(true);
    doc = apply(
      doc,
      toggleOp(doc, 'massnahme', rowOf(doc, 'massnahme', 'massnahme.delete'), 'verwaltung', ROLES),
    );
    expect(
      perms(doc, 'massnahme').canDelete(
        [roleSubject('verwaltung')],
        { id: 'x', type: 'massnahme', properties: {}, lifecycle: 'active', updatedSeq: 0 } as never,
        { vars: new Map(), features: {}, now: '', relations: new Map(), geo: {} } as never,
      ).ok,
    ).toBe(true);
  });

  it('a locked row has no op', () => {
    const doc = need(
      open().apply({ kind: 'set', path: 'types.massnahme.permissions.see', value: ['kontrolle'] }).doc,
    );
    for (const id of ['baum.see', 'massnahme.see.art']) {
      const type = id.split('.')[0] ?? '';
      expect(toggleOp(doc, type, rowOf(doc, type, id), 'bauhof', ROLES)).toBeUndefined();
    }
  });

  it('a property read on a $all type turns the audience into a map: all rows stay visible', () => {
    let doc = open();
    doc = apply(
      doc,
      toggleOp(doc, 'massnahme', rowOf(doc, 'massnahme', 'massnahme.see.art'), 'bauhof', ROLES),
    );
    expect(rowOf(doc, 'massnahme', 'massnahme.see.art').audience).toEqual({
      kind: 'roles',
      roles: ['kontrolle', 'verwaltung'],
    });
    expect(rowOf(doc, 'massnahme', 'massnahme.see').locked).toBe('all_rows_visible');
  });

  it('property: toggling twice is the identity on what core.perms says (property test)', () => {
    const ids = rows(open(), 'baum')
      .filter((r) => r.locked === undefined && r.property !== undefined)
      .map((r) => r.id);
    fc.assert(
      fc.property(fc.constantFrom(...ids), fc.constantFrom(...ROLES), (id, role) => {
        const doc = open();
        const once = apply(doc, toggleOp(doc, 'baum', rowOf(doc, 'baum', id), role, ROLES));
        const twice = apply(once, toggleOp(once, 'baum', rowOf(once, 'baum', id), role, ROLES));
        const a = rowOf(doc, 'baum', id);
        const b = rowOf(twice, 'baum', id);
        expect(b.cells.map((c) => c.allowed)).toEqual(a.cells.map((c) => c.allowed));
        expect(rowOf(once, 'baum', id).cells.find((c) => c.role === role)?.allowed).toBe(
          !a.cells.find((c) => c.role === role)?.allowed,
        );
      }),
      { numRuns: 40 },
    );
  });
});

describe('toggledAudience', () => {
  it('follows v3 toggleRoleInList, with "nobody" instead of an empty list', () => {
    expect(toggledAudience({ kind: 'all' }, 'a', ['a', 'b'])).toEqual({ kind: 'roles', roles: ['b'] });
    expect(toggledAudience({ kind: 'all' }, 'a', ['a'])).toEqual({ kind: 'none' });
    expect(toggledAudience({ kind: 'roles', roles: ['a'] }, 'a', ['a', 'b'])).toEqual({ kind: 'none' });
    expect(toggledAudience({ kind: 'roles', roles: ['a'] }, 'b', ['a', 'b'])).toEqual({ kind: 'all' });
    expect(toggledAudience({ kind: 'none' }, 'b', ['a', 'b'])).toEqual({ kind: 'roles', roles: ['b'] });
  });
});

describe('provenance mark and reset per cell (acceptance 3)', () => {
  it('a cell the draft changed is marked and reset puts it back', () => {
    let doc = open();
    const id = 'baum.write.hoehe_m';
    expect(rowOf(doc, 'baum', id).cells.every((c) => !c.modified)).toBe(true);
    doc = apply(doc, toggleOp(doc, 'baum', rowOf(doc, 'baum', id), 'bauhof', ROLES));
    const row = rowOf(doc, 'baum', id);
    expect(row.cells.filter((c) => c.modified).map((c) => c.role)).toEqual(['bauhof']);
    doc = apply(doc, resetOp(doc, 'baum', row, 'bauhof', ROLES));
    const back = rowOf(doc, 'baum', id);
    expect(back.cells.every((c) => !c.modified)).toBe(true);
    expect(back.cells.map((c) => c.allowed)).toEqual(rowOf(open(), 'baum', id).cells.map((c) => c.allowed));
  });

  it('an untouched cell has nothing to reset', () => {
    const doc = open();
    expect(resetOp(doc, 'baum', rowOf(doc, 'baum', 'baum.write.hoehe_m'), 'bauhof', ROLES)).toBeUndefined();
  });

  it('the type-level cell is marked too', () => {
    let doc = open();
    doc = apply(
      doc,
      toggleOp(doc, 'massnahme', rowOf(doc, 'massnahme', 'massnahme.create'), 'bauhof', ROLES),
    );
    expect(rowOf(doc, 'massnahme', 'massnahme.create').cells.find((c) => c.role === 'bauhof')?.modified).toBe(
      true,
    );
  });
});

describe('Private writes and clears visible_when (acceptance 4)', () => {
  it('on writes self.$created_by == actor.id; off takes it out again; the draft compiles', () => {
    let doc = open();
    expect(privateState(doc.effective(), 'massnahme')).toBe('off');
    doc = apply(doc, privateOp(doc, 'massnahme', true));
    expect(doc.effective().types?.['massnahme']?.permissions?.visible_when).toBe(PRIVATE_WHEN);
    expect(privateState(doc.effective(), 'massnahme')).toBe('on');
    expect(doc.problems()).toEqual(open().problems());
    expect(doc.problems().map((p) => p.code)).not.toContain('visible_when_not_sql');
    doc = apply(doc, privateOp(doc, 'massnahme', false));
    expect(doc.effective().types?.['massnahme']?.permissions?.visible_when).toBeUndefined();
    expect(privateState(doc.effective(), 'massnahme')).toBe('off');
  });

  it('another condition is "custom" and is not overwritten', () => {
    const doc = apply(open(), {
      kind: 'add',
      path: 'types.massnahme.permissions.visible_when',
      value: 'self.erledigt_am == null',
    });
    expect(privateState(doc.effective(), 'massnahme')).toBe('custom');
    expect(privateOp(doc, 'massnahme', true)).toBeUndefined();
  });
});

describe('cellOp', () => {
  it('returns nothing when the audience is already what is asked for', () => {
    const doc = open();
    expect(
      cellOp(
        doc.effective(),
        'massnahme',
        { action: 'create' },
        { kind: 'roles', roles: ['kontrolle', 'verwaltung'] },
      ),
    ).toBeUndefined();
  });
});
