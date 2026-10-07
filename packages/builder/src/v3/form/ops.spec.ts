import { describe, expect, it } from 'vitest';
import { buildFormModel, formLines } from '@ueberblick/ui';
import { openProject, type Doc, type Op } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { editorModel, formOf, libraryOf } from './model';
import { PALETTE_TILES } from './palette';
import {
  columnOps,
  deletePageOps,
  newFieldOps,
  pageBreakOps,
  pageTextOps,
  placeOps,
  removeFromFormOps,
  stepOps,
  uniqueName,
} from './ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const T = 'kontrolle';
const keys = (doc: Doc, task = T): string[] => Object.keys(formOf(doc.effective(), task));
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

/** The file as it is saved and opened again: what a reload sees. */
const reloaded = (doc: Doc): Doc => openProject(musterstadt.templateSrc, doc.save().overlaySrc);
const fresh = (before: Doc, after: Doc): string[] => {
  const known = new Set(before.problems().map(key));
  return after
    .problems()
    .map(key)
    .filter((k) => !known.has(k));
};

describe('order', () => {
  it('moving a field writes the overlay order and survives a reload', () => {
    const doc = open();
    expect(keys(doc)).toEqual(['vitalitaet', 'befund', 'foto', 'hoehe_m', 'hoehe_klasse']);
    const after = apply(
      doc,
      placeOps(doc, T, 'baum', 'foto', { kind: 'line', page: 0, line: 0, column: 'full' }),
    );
    expect(keys(after)).toEqual(['foto', 'vitalitaet', 'befund', 'hoehe_m', 'hoehe_klasse']);
    expect(keys(reloaded(after))).toEqual(keys(after));
    expect(fresh(doc, after)).toEqual([]);
  });

  it('up and down are the same edit one step at a time', () => {
    const doc = open();
    const down = apply(doc, stepOps(doc, T, 'baum', 'vitalitaet', 1));
    expect(keys(down)).toEqual(['befund', 'vitalitaet', 'foto', 'hoehe_m', 'hoehe_klasse']);
    const up = apply(down, stepOps(down, T, 'baum', 'vitalitaet', -1));
    expect(keys(up)).toEqual(keys(doc));
    expect(stepOps(doc, T, 'baum', 'vitalitaet', -1)).toEqual([]);
  });

  it('a moved field that is removed afterwards leaves no stale order entry (no new problem)', () => {
    const doc = open();
    const moved = apply(doc, stepOps(doc, T, 'baum', 'foto', -1));
    const gone = apply(moved, removeFromFormOps(moved, T, 'baum', 'befund'));
    expect(keys(gone)).toEqual(['vitalitaet', 'foto', 'hoehe_m', 'hoehe_klasse']);
    expect(fresh(doc, gone)).toEqual([]);
    expect(keys(reloaded(gone))).toEqual(keys(gone));
  });
});

describe('add and remove', () => {
  it('the library adds a property of the type to the end of the form, or where it is dropped', () => {
    const doc = open();
    const end = apply(doc, placeOps(doc, 'befund_ergaenzen', 'baum', 'art', { kind: 'page', page: 0 }));
    expect(keys(end, 'befund_ergaenzen')).toEqual(['befund', 'art']);
    const first = apply(
      doc,
      placeOps(doc, 'befund_ergaenzen', 'baum', 'art', { kind: 'line', page: 0, line: 0, column: 'full' }),
    );
    expect(keys(first, 'befund_ergaenzen')).toEqual(['art', 'befund']);
    expect(fresh(doc, end)).toEqual([]);
  });

  it('remove takes the entry out and the library offers the property again', () => {
    const doc = open();
    const after = apply(doc, removeFromFormOps(doc, T, 'baum', 'foto'));
    expect(keys(after)).not.toContain('foto');
    expect(libraryOf(after.effective(), T, 'baum', 'de').find((e) => e.key === 'foto')?.used).toBe(false);
    expect(keys(reloaded(after))).toEqual(keys(after));
  });

  it('a field type is a new property with its roles and the form entry (long text: appearance multiline)', () => {
    const doc = open();
    const tile = PALETTE_TILES.find((x) => x.key === 'long_text');
    if (tile === undefined) throw new Error('tile');
    const made = newFieldOps(doc, T, 'baum', tile, 'Neues Feld', 'de', { kind: 'page', page: 0 });
    const after = apply(doc, made.ops);
    const file = after.effective();
    expect(made.key).toBe('neues_feld');
    expect(file.types?.['baum']?.properties[made.key]).toMatchObject({
      type: 'text',
      label: { de: 'Neues Feld' },
    });
    expect(file.tasks?.[T]?.form?.[made.key]).toMatchObject({ appearance: 'multiline' });
    expect(keys(after).at(-1)).toBe(made.key);
    expect(file.types?.['baum']?.permissions?.write).toMatchObject({ [made.key]: '$all' });
    expect(fresh(doc, after)).toEqual([]);
    expect(keys(reloaded(after))).toEqual(keys(after));
  });

  it('every palette tile that can be placed makes a property the checker accepts', () => {
    for (const tile of PALETTE_TILES) {
      const doc = open();
      const made = newFieldOps(doc, T, 'baum', tile, 'Neues Feld', 'de', { kind: 'page', page: 0 });
      const after = apply(doc, made.ops);
      expect(after.effective().types?.['baum']?.properties[made.key]?.type, tile.key).toBe(tile.type);
      expect(fresh(doc, after), tile.key).toEqual([]);
    }
  });

  it('a name is unique among the labels of the type', () => {
    const doc = open();
    const tile = PALETTE_TILES[0];
    if (tile === undefined) throw new Error('tile');
    const first = apply(
      doc,
      newFieldOps(doc, T, 'baum', tile, 'Neues Feld', 'de', { kind: 'page', page: 0 }).ops,
    );
    expect(uniqueName(first.effective(), 'baum', 'de', 'Neues Feld')).toBe('Neues Feld 2');
  });
});

describe('pages', () => {
  it('"Beginnt eine neue Seite" splits the form in the participant model, and a title names the page', () => {
    const doc = open();
    const split = apply(doc, pageBreakOps(doc, T, 'baum', 'foto', true));
    expect(split.effective().tasks?.[T]?.form?.['foto']?.page).toEqual({});
    expect(split.effective().tasks?.[T]?.form?.['befund']?.page).toBeUndefined();
    const titled = apply(split, pageTextOps(split, T, 'baum', 1, 'label', 'de', 'Messwerte'));
    expect(titled.effective().tasks?.[T]?.form?.['foto']?.page).toEqual({ label: { de: 'Messwerte' } });
    const file = reloaded(titled).effective();
    const model = buildFormModel({
      form: file.tasks?.[T]?.form ?? {},
      properties: file.types?.['baum']?.properties ?? {},
    });
    expect(model.pages.map((p) => p.map((f) => f.key))).toEqual([
      ['vitalitaet', 'befund'],
      ['foto', 'hoehe_m', 'hoehe_klasse'],
    ]);
    expect(model.pageInfo[1]?.title).toEqual({ de: 'Messwerte' });
  });

  it('a description goes to the same marker; emptied texts leave the page break alone, and the first page needs no marker', () => {
    const doc = open();
    const a = apply(doc, pageTextOps(doc, T, 'baum', 0, 'hint', 'de', 'Erst das Wichtige'));
    expect(a.effective().tasks?.[T]?.form?.['vitalitaet']?.page).toEqual({
      hint: { de: 'Erst das Wichtige' },
    });
    const b = apply(a, pageTextOps(a, T, 'baum', 0, 'hint', 'de', ''));
    expect(b.effective().tasks?.[T]?.form?.['vitalitaet']?.page).toBeUndefined();
  });

  it('removing the field that starts a page hands the page to the next field', () => {
    const doc = open();
    const split = apply(doc, pageBreakOps(doc, T, 'baum', 'foto', true));
    const after = apply(split, removeFromFormOps(split, T, 'baum', 'foto'));
    expect(after.effective().tasks?.[T]?.form?.['hoehe_m']?.page).toEqual({});
    expect(editorModel(after.effective(), T, 'baum', 'de').layout.pages).toHaveLength(2);
  });

  it('deleting a page joins its fields to the page before', () => {
    const doc = open();
    const split = apply(doc, pageBreakOps(doc, T, 'baum', 'foto', true));
    const joined = apply(split, deletePageOps(split, T, 'baum', 1));
    expect(editorModel(joined.effective(), T, 'baum', 'de').layout.pages).toHaveLength(1);
    expect(keys(joined)).toEqual(keys(doc));
    expect(joined.effective().tasks?.[T]?.form?.['foto']?.page).toBeUndefined();
  });
});

describe('width', () => {
  it('half width is the form entry column and row (the property display stays the view); two neighbours of one row share a line, as in the participant form', () => {
    const doc = open();
    const left = apply(doc, columnOps(doc, T, 'baum', 'hoehe_m', 'left'));
    const both = apply(
      left,
      placeOps(left, T, 'baum', 'hoehe_klasse', { kind: 'side', page: 0, line: 3, column: 'right' }),
    );
    const entries = both.effective().tasks?.[T]?.form ?? {};
    expect(entries['hoehe_m']?.column).toBe('left');
    expect(entries['hoehe_klasse']?.column).toBe('right');
    expect(entries['hoehe_m']?.row).toBe(entries['hoehe_klasse']?.row);
    expect(both.effective().types?.['baum']?.properties['hoehe_m']?.display).toEqual(
      open().effective().types?.['baum']?.properties['hoehe_m']?.display,
    );
    expect(keys(both)).toEqual(['vitalitaet', 'befund', 'foto', 'hoehe_m', 'hoehe_klasse']);
    const file = reloaded(both).effective();
    const model = buildFormModel({
      form: file.tasks?.[T]?.form ?? {},
      properties: file.types?.['baum']?.properties ?? {},
    });
    const lines = formLines(model.fields.map((f) => ({ ...f, row: f.row, column: f.column })));
    expect(lines.map((l) => l.map((f) => f.key))).toEqual([
      ['vitalitaet'],
      ['befund'],
      ['foto'],
      ['hoehe_m', 'hoehe_klasse'],
    ]);
    expect(fresh(doc, both)).toEqual([]);
  });

  it('full width again takes the column off the form entry', () => {
    const doc = open();
    const left = apply(doc, columnOps(doc, T, 'baum', 'hoehe_m', 'left'));
    const full = apply(left, columnOps(left, T, 'baum', 'hoehe_m', 'full'));
    expect(full.effective().tasks?.[T]?.form?.['hoehe_m']?.column).toBeUndefined();
  });
});

describe('the model', () => {
  it('shows the form with required marks, validation and condition badges', () => {
    const m = editorModel(open().effective(), T, 'baum', 'de');
    expect([...m.fields.keys()]).toEqual(['vitalitaet', 'befund', 'foto', 'hoehe_m', 'hoehe_klasse']);
    expect(m.fields.get('befund')).toMatchObject({ required: true, validated: true, label: 'Befund' });
    expect(m.fields.get('foto')).toMatchObject({ conditional: true, type: 'file' });
    expect(m.layout.pages).toHaveLength(1);
  });

  it('the library lists the properties of the type that are not in the form, without stage, geometry and step properties', () => {
    const lib = libraryOf(open().effective(), 'befund_ergaenzen', 'baum', 'de');
    const byKey = new Map(lib.map((e) => [e.key, e]));
    expect(byKey.has('stage')).toBe(false);
    expect(byKey.has('geometrie')).toBe(false);
    expect(byKey.get('befund')).toMatchObject({ used: true, usage: 2 });
    expect(byKey.get('art')).toMatchObject({ used: false, label: 'Baumart' });
    expect(byKey.get('vitalitaet')?.usage).toBe(2);
  });

  it('a field without a property is still a card', () => {
    const doc = apply(open(), [{ kind: 'add', path: `tasks.${T}.form.gibt_es_nicht`, value: {} }]);
    const f = editorModel(doc.effective(), T, 'baum', 'de').fields.get('gibt_es_nicht');
    expect(f).toMatchObject({ key: 'gibt_es_nicht' });
    expect(f?.type).toBeUndefined();
  });
});
