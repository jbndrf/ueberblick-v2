// WP-393: v3's entity selector as property type, `constraint` and `see` map; each writes and reads back.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc, type Op } from '../../doc';
import { messages } from '../../shell/messages';
import { musterstadt } from '../../testing/golden';
import { propertyAudience } from '../field/perms';
import {
  entityConfigOf,
  displayOps,
  entityConstraintOf,
  manyOps,
  parseEntityConstraint,
  rolesOps,
  seeOps,
  sourceOps,
  tableOps,
  tablesOf,
  type RoleLists,
} from './entity';
import { formOf } from './model';
import { newFieldOps, placeOps } from './ops';
import { PALETTE_TILES } from './palette';

const T = 'kontrolle';
const TYPE = 'baum';
const t = messages('de');
const base = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
/** The golden file with the participant field `zustaendig` in the form of `kontrolle`. */
const open = (): Doc => {
  const doc = base();
  return apply(doc, placeOps(doc, T, TYPE, 'zustaendig', { kind: 'page', page: 0 }));
};
const key = (p: { code: string; path: string }): string => `${p.code} ${p.path}`;
function apply(doc: Doc, ops: readonly Op[]): Doc {
  let cur = doc;
  for (const op of ops) {
    const r = cur.apply(op);
    expect(r.refused, JSON.stringify(op)).toBeUndefined();
    cur = r.doc;
  }
  return cur;
}
const reloaded = (doc: Doc): Doc => openProject(musterstadt.templateSrc, doc.save().overlaySrc);
const tile = (k: string) => {
  const found = PALETTE_TILES.find((x) => x.key === k);
  if (found === undefined) throw new Error(k);
  return found;
};
const fresh = (before: Doc, after: Doc): string[] => {
  const known = new Set(before.problems().map(key));
  return after
    .problems()
    .map(key)
    .filter((k) => !known.has(k));
};
const cfg = (doc: Doc, k: string, template?: Doc) =>
  entityConfigOf(doc.effective(), T, TYPE, k, 'de', template?.effective());

describe('the constraint of the role lists', () => {
  it('writes nothing for no roles, and the register shape for the others', () => {
    expect(entityConstraintOf({ any: [], self: [] })).toBeUndefined();
    expect(entityConstraintOf({ any: ['verwaltung'], self: [] })).toBe(
      "value == actor.id || 'verwaltung' in actor.roles",
    );
    expect(entityConstraintOf({ any: [], self: ['kontrolle', 'bauhof'] })).toBe(
      "value == actor.id || !('kontrolle' in actor.roles || 'bauhof' in actor.roles)",
    );
    expect(entityConstraintOf({ any: ['verwaltung'], self: ['bauhof'] })).toBe(
      "value == actor.id || 'verwaltung' in actor.roles || !('bauhof' in actor.roles)",
    );
  });

  it('property: reading back what was written gives the lists; a hand-written rule is foreign', () => {
    const role = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
    const lists = fc.record({
      any: fc.uniqueArray(role, { maxLength: 3 }),
      self: fc.uniqueArray(role, { maxLength: 3 }),
    });
    fc.assert(
      fc.property(lists, (l: RoleLists) => {
        const parsed = parseEntityConstraint(entityConstraintOf(l));
        expect(parsed).toEqual({ foreign: false, roles: l });
      }),
    );
    expect(parseEntityConstraint("value == actor.id && 'a' in actor.roles")).toEqual({
      foreign: true,
      expr: "value == actor.id && 'a' in actor.roles",
    });
  });
});

describe('through the file', () => {
  it('reads a participant and a reference property of the golden file', () => {
    const doc = open();
    expect(cfg(doc, 'zustaendig').source).toBe('participants');
    const art = cfg(doc, 'art');
    expect(art.source).toBe('table');
    expect(art.table).toBe('baumart');
  });

  it('the tables are the types without geometry and process', () => {
    expect(tablesOf(open().effective(), 'de').map((x) => x.key)).toEqual(['baumart', 'massnahme']);
  });

  it('the palette makes a reference to the first table, who may write it, in the form', () => {
    const doc = open();
    const made = newFieldOps(doc, T, TYPE, tile('custom_table_selector'), 'Neu', 'de', {
      kind: 'page',
      page: 0,
    });
    const next = apply(doc, made.ops);
    expect(next.effective().types?.[TYPE]?.properties[made.key]).toMatchObject({
      type: 'reference',
      to: 'baumart',
    });
    expect(formOf(next.effective(), T)[made.key]).toBeDefined();
    expect(fresh(doc, next)).toEqual([]);
  });

  it('switching to Teilnehmende makes a participant property, back to Tabelle a reference', () => {
    const doc = open();
    const to = apply(doc, sourceOps(doc, T, TYPE, 'art', 'participants', ['baumart'], 'de', t));
    expect(to.effective().types?.[TYPE]?.properties['art']).toMatchObject({ type: 'participant' });
    expect(to.effective().types?.[TYPE]?.properties['art']).not.toHaveProperty('to');
    const back = apply(to, sourceOps(to, T, TYPE, 'art', 'table', ['baumart'], 'de', t));
    expect(back.effective().types?.[TYPE]?.properties['art']).toMatchObject({
      type: 'reference',
      to: 'baumart',
    });
    expect(sourceOps(doc, T, TYPE, 'art', 'table', ['baumart'], 'de', t)).toEqual([]);
  });

  it('moving a participant field to a table drops the role rule', () => {
    const doc = open();
    const lists = apply(
      doc,
      rolesOps(doc, T, TYPE, 'zustaendig', { any: ['verwaltung'], self: [] }, 'de', t),
    );
    const next = apply(lists, sourceOps(lists, T, TYPE, 'zustaendig', 'table', ['baumart'], 'de', t));
    expect(formOf(next.effective(), T)['zustaendig']?.constraint).toBeUndefined();
    expect(cfg(next, 'zustaendig').source).toBe('table');
  });

  it("the table is the property's `to`", () => {
    const doc = open();
    const next = apply(doc, tableOps(doc, TYPE, 'art', 'flaeche'));
    expect(cfg(next, 'art').table).toBe('flaeche');
  });

  it('the roles write the constraint of the form entry and read back after a reload', () => {
    const doc = open();
    const next = apply(
      doc,
      rolesOps(doc, T, TYPE, 'zustaendig', { any: ['verwaltung'], self: ['kontrolle'] }, 'de', t),
    );
    expect(formOf(next.effective(), T)['zustaendig']?.constraint).toBe(
      "value == actor.id || 'verwaltung' in actor.roles || !('kontrolle' in actor.roles)",
    );
    expect(cfg(reloaded(next), 'zustaendig').constraint).toEqual({
      foreign: false,
      roles: { any: ['verwaltung'], self: ['kontrolle'] },
    });
    expect(fresh(doc, next)).toEqual([]);
    const cleared = apply(next, rolesOps(next, T, TYPE, 'zustaendig', { any: [], self: [] }, 'de', t));
    expect(formOf(cleared.effective(), T)['zustaendig']?.constraint).toBeUndefined();
    expect(formOf(cleared.effective(), T)['zustaendig']?.constraint_message).toBeUndefined();
  });

  it('a hand-written constraint is not touched by the role lists', () => {
    const doc = apply(open(), [
      { kind: 'set', path: `tasks.${T}.form.zustaendig.constraint`, value: 'value != self.zustaendig' } as Op,
    ]);
    expect(cfg(doc, 'zustaendig').constraint.foreign).toBe(true);
    expect(rolesOps(doc, T, TYPE, 'zustaendig', { any: ['a'], self: [] }, 'de', t)).toEqual([]);
  });

  it('"Rollen mit Sichtbarkeit" is the see map of WP-337, and empty means all roles', () => {
    const doc = open();
    const next = apply(doc, seeOps(doc, TYPE, 'art', ['verwaltung']));
    expect(propertyAudience(next.effective(), TYPE, 'see', 'art')).toEqual({
      kind: 'roles',
      roles: ['verwaltung'],
    });
    expect(cfg(next, 'art').see).toEqual({ kind: 'roles', roles: ['verwaltung'] });
    const all = apply(next, seeOps(next, TYPE, 'art', []));
    expect(propertyAudience(all.effective(), TYPE, 'see', 'art')).toEqual({ kind: 'all' });
    expect(fresh(doc, next)).toEqual([]);
  });
});

describe('"Mehrfachauswahl erlauben" and "Anzeigefeld" (WP-443, A-048)', () => {
  it('Mehrfachauswahl is cardinality many on a table and on a participant source, and reads back after a reload', () => {
    const doc = open();
    expect(cfg(doc, 'art').many).toBe(false);
    for (const k of ['art', 'zustaendig']) {
      const next = apply(doc, manyOps(doc, TYPE, k, true, false));
      expect(next.effective().types?.[TYPE]?.properties[k]?.cardinality).toBe('many');
      expect(cfg(reloaded(next), k).many).toBe(true);
      // a many participant is a list of ids for expressions: the golden view that compares it as one id is flagged
      expect(fresh(doc, next)).toEqual(
        k === 'zustaendig' ? ['expression_type views.meine_aufgaben.source.filter'] : [],
      );
    }
    expect(manyOps(doc, TYPE, 'art', false, false)).toEqual([]);
  });

  it('switching Mehrfachauswahl off takes the key out, unless the template declares it many', () => {
    const doc = open();
    const many = apply(doc, manyOps(doc, TYPE, 'art', true, false));
    expect(cfg(many, 'art', many).manyLocked).toBe(true);
    expect(cfg(many, 'art', doc).manyLocked).toBe(false);
    expect(manyOps(many, TYPE, 'art', false, true)).toEqual([]);
    const one = apply(many, manyOps(many, TYPE, 'art', false, false));
    expect(one.effective().types?.[TYPE]?.properties['art']).not.toHaveProperty('cardinality');
  });

  it('Mehrfachauswahl survives a switch of the source, Anzeigefeld does not', () => {
    const doc = open();
    const many = apply(doc, manyOps(doc, TYPE, 'art', true, false));
    const shown = apply(many, displayOps(many, TYPE, 'art', 'name_lat'));
    const to = apply(shown, sourceOps(shown, T, TYPE, 'art', 'participants', ['baumart'], 'de', t));
    const prop = to.effective().types?.[TYPE]?.properties['art'];
    expect(prop).toMatchObject({ type: 'participant', cardinality: 'many' });
    expect(prop).not.toHaveProperty('display_property');
    expect(fresh(doc, to)).toEqual([]);
  });

  it('Anzeigefeld is a property of the table, offered with its label and type, and reads back', () => {
    const doc = open();
    const c = cfg(doc, 'art');
    expect(c.display).toBeUndefined();
    expect(c.columns).toEqual([
      { key: 'name_de', label: 'Name', kind: 'text' },
      { key: 'name_lat', label: 'Lateinischer Name', kind: 'text' },
    ]);
    const next = apply(doc, displayOps(doc, TYPE, 'art', 'name_lat'));
    expect(cfg(reloaded(next), 'art').display).toBe('name_lat');
    expect(fresh(doc, next)).toEqual([]);
    const back = apply(next, displayOps(next, TYPE, 'art', undefined));
    expect(cfg(back, 'art').display).toBeUndefined();
    expect(displayOps(doc, TYPE, 'art', undefined)).toEqual([]);
  });

  it('choosing another table drops an Anzeigefeld that table lacks (compile refuses it otherwise)', () => {
    const doc = open();
    const shown = apply(doc, displayOps(doc, TYPE, 'art', 'name_lat'));
    const moved = apply(shown, tableOps(shown, TYPE, 'art', 'massnahme'));
    expect(cfg(moved, 'art').display).toBeUndefined();
    expect(fresh(shown, moved).filter((k) => k.startsWith('dangling_reference'))).toEqual([]);
    const kept = apply(shown, tableOps(shown, TYPE, 'art', 'baumart'));
    expect(kept).toBe(shown);
  });
});
