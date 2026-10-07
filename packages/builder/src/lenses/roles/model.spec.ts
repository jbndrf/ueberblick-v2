import { compile, NO_ASSETS, compilePerms, roleSubject, type Key } from '@ueberblick/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { INITIAL_CELLS, ROWS_PER_TYPE, buildMatrix, initiallyOpenTypes } from './model';
import { appEntryOp, cellOp, entryOf, homeOp, nextAudience, restrictSeeOp, visibleWhenOp } from './ops';

function need<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value');
  return v;
}
const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const reopen = (d: Doc): Doc => openProject(d.templateSrc, d.save().overlaySrc);

function perms(doc: Doc) {
  const c = compile(doc.effective(), { assets: NO_ASSETS });
  if (!c.ok) throw new Error('does not compile');
  return compilePerms(c.config);
}
const row = (doc: Doc, type: string, id: string) => {
  const t = buildMatrix(doc, 'en').types.find((x) => x.key === type);
  const r = [...(t?.rows ?? []), ...(t?.propertyRows ?? [])].find((x) => x.id === `${type}.${id}`);
  if (r === undefined) throw new Error(`no row ${type}.${id}`);
  return r;
};
const cell = (doc: Doc, type: string, id: string, role: string) =>
  row(doc, type, id).cells.find((c) => c.subject === roleSubject(role));

describe('matrix: effective permission per cell equals core.perms', () => {
  it('columns are the roles of the file, as subjects', () => {
    const m = buildMatrix(open(), 'en');
    expect(m.available).toBe(true);
    expect(m.columns.map((c) => c.subject)).toEqual(
      Object.keys(open().effective().roles ?? {}).map(roleSubject),
    );
  });

  it('every create / write / property cell agrees with core.perms', () => {
    const doc = open();
    const p = perms(doc);
    const m = buildMatrix(doc, 'en');
    let checked = 0;
    for (const t of m.types) {
      const tp = p.forType(t.key as Key);
      for (const col of m.columns) {
        const cr = t.rows.find((r) => r.action === 'create')?.cells.find((c) => c.subject === col.subject);
        expect(cr?.allowed).toBe(tp?.canCreate([col.subject]).ok);
        for (const r of t.propertyRows) {
          const c = r.cells.find((x) => x.subject === col.subject);
          const want =
            r.action === 'write'
              ? tp?.canWrite([col.subject], [r.property ?? '']).ok
              : tp?.readable([col.subject]).has(r.property ?? '');
          expect(c?.allowed, `${r.id} ${col.subject}`).toBe(want);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('the see row follows the audience of a see-by-type type and marks visible_when as conditional', () => {
    const doc = open();
    const tp = perms(doc);
    for (const t of buildMatrix(doc, 'en').types) {
      const see = t.rows.find((r) => r.action === 'see');
      for (const c of see?.cells ?? []) {
        const sql = tp
          .forType(t.key as Key)
          ?.seeSql(
            [c.subject],
            { id: 'x', kind: 'admin', roles: [c.subject.slice(5) as Key] },
            'f',
            '2026-01-01T00:00:00Z',
          );
        expect(c.allowed).toBe(sql?.kind !== 'none');
        expect(c.conditional).toBe(t.visibleWhen !== undefined);
      }
    }
  });

  it('is unavailable (not guessed) while the file does not compile', () => {
    const d = open().apply({ kind: 'set', path: 'types.baum.properties.art.to', value: 'gibt_es_nicht' }).doc;
    expect(buildMatrix(d, 'en').available).toBe(false);
  });
});

describe('matrix edit <-> file round trip', () => {
  const sub = roleSubject('bauhof');

  it('toggling a create cell writes the file, and the reopened overlay shows the same cell', () => {
    const doc = open();
    expect(cell(doc, 'baum', 'create', 'bauhof')?.allowed).toBe(false);
    const op = cellOp(doc.effective(), { type: 'baum', action: 'create', subject: sub, on: true });
    expect(op).toBeDefined();
    const r = doc.apply(need(op));
    expect(r.refused).toBeUndefined();
    expect(cell(r.doc, 'baum', 'create', 'bauhof')?.allowed).toBe(true);
    expect(cell(reopen(r.doc), 'baum', 'create', 'bauhof')?.allowed).toBe(true);
    // Untouched cells are untouched.
    expect(cell(reopen(r.doc), 'baum', 'create', 'kontrolle')?.allowed).toBe(true);
    // ... and back off.
    const off = r.doc.apply(
      need(cellOp(r.doc.effective(), { type: 'baum', action: 'create', subject: sub, on: false })),
    );
    expect(cell(reopen(off.doc), 'baum', 'create', 'bauhof')?.allowed).toBe(false);
  });

  it('a property write cell keeps the other properties as they were', () => {
    const doc = open();
    const before = need(buildMatrix(doc, 'en').types.find((t) => t.key === 'baum'));
    const op = cellOp(doc.effective(), {
      type: 'baum',
      action: 'write',
      property: 'befund',
      subject: sub,
      on: true,
    });
    const r = doc.apply(need(op));
    expect(r.refused).toBeUndefined();
    const after = need(buildMatrix(reopen(r.doc), 'en').types.find((t) => t.key === 'baum'));
    for (const pr of after.propertyRows) {
      const was = need(before.propertyRows.find((x) => x.id === pr.id));
      for (const c of pr.cells) {
        const changed = pr.id === 'baum.write.befund' && c.subject === sub;
        expect(c.allowed).toBe(changed ? true : need(was.cells.find((x) => x.subject === c.subject)).allowed);
      }
    }
  });

  it('a whole-type write cell on a by-type type expands to per property when one property is toggled', () => {
    const doc = open();
    const before = row(doc, 'flaeche', 'write');
    expect(before.editable).toBe(true);
    const op = cellOp(doc.effective(), {
      type: 'flaeche',
      action: 'write',
      property: 'name',
      subject: sub,
      on: true,
    });
    const r = doc.apply(need(op));
    expect(r.refused).toBeUndefined();
    expect(cell(r.doc, 'flaeche', 'write.name', 'bauhof')?.allowed).toBe(true);
    expect(cell(r.doc, 'flaeche', 'write.geometrie', 'bauhof')?.allowed).toBe(false);
    expect(cell(r.doc, 'flaeche', 'write.geometrie', 'verwaltung')?.allowed).toBe(true);
  });

  it('a type without permissions gets the map added; two edits in a row both apply', () => {
    let doc = open().apply({
      kind: 'add',
      path: 'types.neu',
      value: { label: { en: 'New' }, properties: { name: { type: 'text' } } },
    }).doc;
    for (const a of ['create', 'delete'] as const) {
      const r = doc.apply(need(cellOp(doc.effective(), { type: 'neu', action: a, subject: sub, on: true })));
      expect(r.refused).toBeUndefined();
      doc = r.doc;
    }
    expect(cell(reopen(doc), 'neu', 'create', 'bauhof')?.allowed).toBe(true);
    expect(cell(reopen(doc), 'neu', 'delete', 'bauhof')?.allowed).toBe(true);
  });

  it('whole-type see / write cells are not editable while the file keys them by property, and say why', () => {
    const doc = open();
    const see = row(doc, 'baum', 'see');
    expect(see.editable).toBe(false);
    expect(see.note).toBe('all_rows_visible');
    expect(cellOp(doc.effective(), { type: 'baum', action: 'see', subject: sub, on: true })).toBeUndefined();
    expect(row(doc, 'baum', 'write').note).toBe('per_property');
    expect(
      cellOp(doc.effective(), { type: 'baum', action: 'write', subject: sub, on: true }),
    ).toBeUndefined();
  });

  it('restricting see per property is one explicit op, after which property see cells are editable', () => {
    const doc = open();
    expect(
      cellOp(doc.effective(), { type: 'flaeche', action: 'see', property: 'name', subject: sub, on: false }),
    ).toBeUndefined();
    const r = doc.apply(restrictSeeOp(doc.effective(), 'flaeche'));
    expect(r.refused).toBeUndefined();
    const op = cellOp(r.doc.effective(), {
      type: 'flaeche',
      action: 'see',
      property: 'name',
      subject: sub,
      on: false,
    });
    const r2 = r.doc.apply(need(op));
    expect(r2.refused).toBeUndefined();
    expect(cell(reopen(r2.doc), 'flaeche', 'see.name', 'bauhof')?.allowed).toBe(false);
    expect(cell(reopen(r2.doc), 'flaeche', 'see.name', 'kontrolle')?.allowed).toBe(true);
  });

  it('visible_when: set, then empty removes it; the see row turns conditional', () => {
    const doc = open();
    const set = doc.apply(need(visibleWhenOp(doc, 'flaeche', "actor.kind == 'admin'")));
    expect(set.refused).toBeUndefined();
    expect(cell(set.doc, 'flaeche', 'see', 'kontrolle')?.conditional).toBe(true);
    const cleared = set.doc.apply(need(visibleWhenOp(set.doc, 'flaeche', '  ')));
    expect(cleared.refused).toBeUndefined();
    expect(cell(cleared.doc, 'flaeche', 'see', 'kontrolle')?.conditional).toBe(false);
    expect(visibleWhenOp(cleared.doc, 'flaeche', '')).toBeUndefined();
  });

  it('an invalid visible_when is refused, not written', () => {
    const doc = open();
    const r = doc.apply(need(visibleWhenOp(doc, 'flaeche', 'self.gibt_es_nicht ==')));
    expect(r.refused !== undefined || r.problems.length > doc.problems().length).toBe(true);
  });
});

describe('audience edits (properties)', () => {
  const roles = ['a', 'b', 'c'].map(roleSubject);
  const subject = fc.constantFrom(...roles);
  const audience = fc.oneof(
    fc.constant('$all' as string | readonly string[] | undefined),
    fc.constant(undefined),
    fc.subarray(['a', 'b', 'c']),
  );
  const has = (a: string | readonly string[] | undefined, s: string): boolean =>
    a === '$all' || (Array.isArray(a) && (a as readonly string[]).includes(entryOf(s)));

  it('turning a subject on makes it admitted, off makes it refused, and the others do not change', () => {
    fc.assert(
      fc.property(audience, subject, fc.boolean(), (a, s, on) => {
        const next = nextAudience(a, s, on, roles);
        expect(has(next, s)).toBe(on);
        for (const o of roles.filter((x) => x !== s)) expect(has(next, o)).toBe(has(a, o));
      }),
    );
  });
  it('is idempotent', () => {
    fc.assert(
      fc.property(audience, subject, fc.boolean(), (a, s, on) => {
        const once = nextAudience(a, s, on, roles);
        expect(nextAudience(once, s, on, roles)).toEqual(once);
      }),
    );
  });
  it('team subjects are written as they are (O12)', () => {
    expect(nextAudience(['a'], 'team:nord', true, roles)).toEqual(['a', 'team:nord']);
  });
});

describe('app profile entries (keyed maps, one entry at a time)', () => {
  it('adds one view to a role and drops it again, leaving the other entries', () => {
    let doc = open();
    const before = doc.effective().roles?.['bauhof']?.app?.views;
    const r = doc.apply(appEntryOp(doc, 'bauhof', 'views', 'karte', true));
    expect(r.refused).toBeUndefined();
    doc = r.doc;
    expect(Object.keys(doc.effective().roles?.['bauhof']?.app?.views ?? {})).toEqual([
      ...Object.keys(before ?? {}),
      'karte',
    ]);
    const off = doc.apply(appEntryOp(doc, 'bauhof', 'views', 'karte', false));
    expect(off.refused).toBeUndefined();
    expect(Object.keys(off.doc.effective().roles?.['bauhof']?.app?.views ?? {})).toEqual(
      Object.keys(before ?? {}),
    );
  });

  it('hides a template entry and shows it again with unhide (no duplicate add)', () => {
    const doc = open();
    const hidden = doc.apply(appEntryOp(doc, 'kontrolle', 'tools', 'measure', false));
    expect(hidden.refused).toBeUndefined();
    expect(hidden.doc.effective().roles?.['kontrolle']?.app?.tools).not.toHaveProperty('measure');
    const back = hidden.doc.apply(appEntryOp(hidden.doc, 'kontrolle', 'tools', 'measure', true));
    expect(back.refused).toBeUndefined();
    expect(back.doc.effective().roles?.['kontrolle']?.app?.tools).toHaveProperty('measure');
    expect(reopen(back.doc).effective().roles?.['kontrolle']?.app?.tools).toHaveProperty('measure');
  });

  it('creates the profile of a role that has none', () => {
    const doc = open().apply({ kind: 'add', path: 'roles.gast', value: { label: { en: 'Guest' } } }).doc;
    const r = doc.apply(appEntryOp(doc, 'gast', 'views', 'karte', true));
    expect(r.refused).toBeUndefined();
    expect(r.doc.effective().roles?.['gast']?.app).toEqual({ views: { karte: {} } });
    const h = r.doc.apply(homeOp(r.doc, 'gast', 'karte'));
    expect(h.refused).toBeUndefined();
    expect(h.doc.effective().roles?.['gast']?.app?.home).toBe('karte');
  });

  it('sets the home view of a role with a profile', () => {
    const doc = open();
    const r = doc.apply(homeOp(doc, 'kontrolle', 'meine_aufgaben'));
    expect(r.refused).toBeUndefined();
    expect(r.doc.effective().roles?.['kontrolle']?.app?.home).toBe('meine_aufgaben');
  });
});

describe('initiallyOpenTypes (R14: the first render is bounded)', () => {
  const cols = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `r${i}` }) as never);
  const types = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `t${i}` }) as never);
  const matrix = (nt: number, nc: number) => ({ available: true, columns: cols(nc), types: types(nt) });

  it('opens types in file order while their permission boxes fit the budget', () => {
    const open = initiallyOpenTypes(matrix(100, 10));
    expect(open.size).toBe(Math.floor(INITIAL_CELLS / (ROWS_PER_TYPE * 10)));
    expect(open.has('t0')).toBe(true);
    expect(open.has(`t${open.size}`)).toBe(false);
  });

  it('opens every type of a small matrix, and the first one even when it alone is over budget', () => {
    expect(initiallyOpenTypes(matrix(4, 5)).size).toBe(4);
    expect([...initiallyOpenTypes(matrix(3, INITIAL_CELLS))]).toEqual(['t0']);
  });

  it('is bounded for any size', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 1, max: 60 }), (nt, nc) => {
        const n = initiallyOpenTypes(matrix(nt, nc)).size;
        expect(n * ROWS_PER_TYPE * nc).toBeLessThanOrEqual(Math.max(INITIAL_CELLS, ROWS_PER_TYPE * nc));
      }),
    );
  });
});
