import { listAutos } from '@ueberblick/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyOps, openProject, type Doc, type Op } from '../../../doc';
import { musterstadt } from '../../../testing/golden';
import { HUB_DEFAULT_TAB, WRITE_MODES, buildFieldHub, searchFields } from './hub';
import { addFieldOp, dropOnCardOps, dropOnTabOp, hideOp, moveOp, nextRow, showOp } from './ops';
import {
  addToTabOps,
  deleteTabOps,
  moveLineOps,
  moveToTabOps,
  newTabName,
  removeFromTabOps,
  renameTabOps,
  reach,
  setColumnOps,
  setHiddenOp,
} from './layout-ops';
import { readsSelf, usedIn } from './used-in';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const file = (d: Doc) => d.effective();

function take(doc: Doc, ...ops: Op[]): Doc {
  const r = applyOps(doc, ops);
  if ('refused' in r) throw new Error(`refused: ${r.refused.message}`);
  expect(r.problems).toEqual(doc.problems());
  return r.doc;
}
const display = (d: Doc, key: string) => file(d).types?.['baum']?.properties[key]?.display;

describe('used-in is read from the file (acceptance 1)', () => {
  it('lists the tasks whose form writes a property and the tasks whose then-steps do', () => {
    const f = file(open());
    expect(usedIn(f, 'baum', 'befund').tasks).toEqual(
      expect.arrayContaining(['kontrolle', 'befund_ergaenzen']),
    );
    expect(usedIn(f, 'baum', 'stage').tasks).toEqual(expect.arrayContaining(['kontrolle']));
    expect(usedIn(f, 'baum', 'kontrolle_faellig').tasks).toContain('kontrolle');
    // a task that creates another type writes that type's properties, not the tree's
    expect(usedIn(f, 'baum', 'art').tasks).not.toContain('massnahme_anlegen');
  });

  it('lists the rules that read a property: the change trigger and self.<property> in a condition', () => {
    const f = file(open());
    const withRules = listAutos(f);
    expect(withRules.length).toBeGreaterThan(0);
    const changeRule = withRules.find((a) => a.entry.change?.startsWith('baum.') === true);
    if (changeRule !== undefined) {
      const property = String(changeRule.entry.change).split('.')[1] as string;
      expect(usedIn(f, 'baum', property).rules).toContain(changeRule.id);
    }
    expect(usedIn(f, 'baum', 'intern_notiz')).toEqual({ tasks: [], rules: [] });
  });

  it('readsSelf finds self.<property> anywhere in a condition and nothing in text that does not parse', () => {
    expect(readsSelf("self.stage == 'x' && actor.id != null", 'stage')).toBe(true);
    expect(readsSelf('has(self.hoehe_m) || 1 > 0', 'hoehe_m')).toBe(true);
    expect(readsSelf("other.stage == 'x'", 'stage')).toBe(false);
    expect(readsSelf('self.stage ==', 'stage')).toBe(false);
    expect(readsSelf(undefined, 'stage')).toBe(false);
  });
});

describe('the hub model is the Daten layout (acceptance 1)', () => {
  it('lists every property but the geometry, in the default tab, with type, required and write mode', () => {
    const hub = buildFieldHub(file(open()), 'baum', 'de');
    const keys = hub.all.map((f) => f.key);
    expect(keys).not.toContain('geometrie');
    expect(keys).toEqual(expect.arrayContaining(['stage', 'vitalitaet', 'hoehe_m', 'foto']));
    expect(hub.tabs.map((t) => t.name)).toEqual([HUB_DEFAULT_TAB]);
    const hoehe = hub.all.find((f) => f.key === 'hoehe_m');
    expect(hoehe).toMatchObject({
      label: 'Höhe (m)',
      type: 'number',
      required: false,
      writeMode: WRITE_MODES.single,
    });
    expect(hub.all.find((f) => f.key === 'befund')?.usedIn.tasks).toContain('kontrolle');
    expect(hub.hidden).toEqual([]);
  });

  it('hiding moves a property to the library and showing brings it back as the last row', () => {
    let doc = take(open(), hideOp(file(open()), 'baum', 'intern_notiz'));
    let hub = buildFieldHub(file(doc), 'baum', 'de');
    expect(hub.hidden.map((f) => f.key)).toEqual(['intern_notiz']);
    expect(hub.tabs[0]?.lines.flat().map((f) => f.key)).not.toContain('intern_notiz');
    doc = take(doc, showOp(file(doc), 'baum', 'intern_notiz', 'de'));
    hub = buildFieldHub(file(doc), 'baum', 'de');
    expect(hub.hidden).toEqual([]);
    expect(hub.tabs[0]?.lines.flat().map((f) => f.key)).toContain('intern_notiz');
  });

  it('a new tab, rows and half-width columns come out as lines in v3 order', () => {
    let doc = open();
    doc = take(doc, moveOp(file(doc), 'baum', 'hoehe_m', { tab: 'Messung', row: 0, column: 'left' }, 'de'));
    doc = take(
      doc,
      moveOp(file(doc), 'baum', 'hoehe_klasse', { tab: 'Messung', row: 0, column: 'right' }, 'de'),
    );
    doc = take(
      doc,
      moveOp(file(doc), 'baum', 'vitalitaet', { tab: 'Messung', row: 1, column: 'full' }, 'de'),
    );
    const hub = buildFieldHub(file(doc), 'baum', 'de');
    expect(hub.tabs.map((t) => t.name)).toEqual([HUB_DEFAULT_TAB, 'Messung']);
    expect(hub.tabs[1]?.lines.map((l) => l.map((f) => f.key))).toEqual([
      ['hoehe_m', 'hoehe_klasse'],
      ['vitalitaet'],
    ]);
    expect(display(doc, 'hoehe_m')).toMatchObject({ tab: { de: 'Messung' }, row: 0, column: 'left' });
  });

  it('a second property put on an existing tab reuses the tab name of the first (one localized name)', () => {
    let doc = open();
    doc = take(doc, moveOp(file(doc), 'baum', 'hoehe_m', { tab: 'Messung', row: 0, column: 'full' }, 'en'));
    doc = take(doc, moveOp(file(doc), 'baum', 'befund', { tab: 'Messung', row: 1, column: 'full' }, 'en'));
    expect(display(doc, 'befund')?.tab).toEqual(display(doc, 'hoehe_m')?.tab);
  });

  it('dropping a property onto a full-width card makes the pair share that row', () => {
    let doc = take(
      open(),
      moveOp(file(open()), 'baum', 'hoehe_m', { tab: HUB_DEFAULT_TAB, row: 0, column: 'full' }, 'de'),
    );
    doc = take(doc, ...dropOnCardOps(file(doc), 'baum', 'befund', 'hoehe_m', 'right', 'de'));
    const line = buildFieldHub(file(doc), 'baum', 'de').tabs[0]?.lines[0]?.map((f) => f.key);
    expect(line).toEqual(['hoehe_m', 'befund']);
    expect(dropOnCardOps(file(doc), 'baum', 'befund', 'befund', 'left', 'de')).toEqual([]);
  });

  it('dropping on a tab appends a new last row and the default tab carries no tab value', () => {
    let doc = take(open(), dropOnTabOp(file(open()), 'baum', 'befund', 'Zweite', 'de'));
    expect(display(doc, 'befund')).toMatchObject({ tab: { de: 'Zweite' }, row: 0 });
    doc = take(doc, dropOnTabOp(file(doc), 'baum', 'befund', HUB_DEFAULT_TAB, 'de'));
    expect(display(doc, 'befund')?.tab).toBeUndefined();
    expect(buildFieldHub(file(doc), 'baum', 'de').tabs.map((t) => t.name)).toEqual([HUB_DEFAULT_TAB]);
  });

  it('the write mode reads a computed property and a measurement series', () => {
    const doc = take(open(), {
      kind: 'set',
      path: 'types.baum.properties.hoehe_m.display',
      value: { history: 'measurements' },
    });
    expect(buildFieldHub(file(doc), 'baum', 'de').all.find((f) => f.key === 'hoehe_m')?.writeMode).toBe(
      WRITE_MODES.observation,
    );
  });
});

describe('search filters by label, key and type (acceptance 1)', () => {
  const hub = buildFieldHub(file(open()), 'baum', 'de');
  const typeLabel = (t: string): string => (t === 'number' ? 'Zahl' : t);
  it('matches the label, the key, the type label, case-insensitively', () => {
    expect(searchFields(hub.all, 'höhe', typeLabel).map((f) => f.key)).toEqual(
      expect.arrayContaining(['hoehe_m', 'hoehe_klasse']),
    );
    expect(searchFields(hub.all, 'HOEHE_M', typeLabel).map((f) => f.key)).toEqual(['hoehe_m']);
    expect(searchFields(hub.all, 'zahl', typeLabel).map((f) => f.key)).toContain('hoehe_m');
    expect(searchFields(hub.all, 'gibtsnicht', typeLabel)).toEqual([]);
    expect(searchFields(hub.all, '  ', typeLabel)).toEqual(hub.all);
  });
});

describe('adding a field from the hub creates a property (acceptance 3)', () => {
  it('adds a hidden text property with a unique label and key', () => {
    let doc = open();
    const first = addFieldOp(file(doc), 'baum', 'Neues Feld', 'de');
    doc = take(doc, first.op);
    expect(file(doc).types?.['baum']?.properties[first.key]).toMatchObject({
      type: 'text',
      label: { de: 'Neues Feld' },
      display: { hidden: true },
    });
    expect(buildFieldHub(file(doc), 'baum', 'de').hidden.map((f) => f.key)).toEqual([first.key]);
    const second = addFieldOp(file(doc), 'baum', 'Neues Feld', 'de');
    expect(second.key).not.toBe(first.key);
    doc = take(doc, second.op);
    expect(buildFieldHub(file(doc), 'baum', 'de').hidden.map((f) => f.label)).toEqual([
      'Neues Feld',
      'Neues Feld 2',
    ]);
  });
});

describe('layout ops keep the file valid (property)', () => {
  it('any sequence of moves, hides and shows leaves the draft without new problems', () => {
    const keys = ['hoehe_m', 'befund', 'vitalitaet', 'foto', 'intern_notiz', 'zustaendig'];
    const tabs = [HUB_DEFAULT_TAB, 'A', 'B'];
    const step = fc.record({
      key: fc.constantFrom(...keys),
      tab: fc.constantFrom(...tabs),
      column: fc.constantFrom(...(['left', 'right', 'full'] as const)),
      hide: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 6 }), (steps) => {
        let doc = open();
        for (const s of steps) {
          const f = file(doc);
          doc = take(
            doc,
            s.hide
              ? hideOp(f, 'baum', s.key)
              : moveOp(
                  f,
                  'baum',
                  s.key,
                  { tab: s.tab, row: nextRow(f, 'baum', s.tab, 'de'), column: s.column },
                  'de',
                ),
          );
        }
        const hub = buildFieldHub(file(doc), 'baum', 'de');
        const shown = hub.tabs.flatMap((t) => t.lines.flat()).length;
        expect(shown + hub.hidden.length).toBe(hub.all.length);
      }),
      { numRuns: 25 },
    );
  });
});

describe('the hub lists a large Objektart whole', () => {
  it('builds 300 properties (the timing is bench/builder-model)', () => {
    const base = file(open());
    const properties = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`feld_${i}`, { type: 'text', label: { de: `Feld ${i}` } }]),
    );
    const big = {
      ...base,
      types: { ...base.types, baum: { ...base.types?.['baum'], properties } },
    } as typeof base;
    expect(buildFieldHub(big, 'baum', 'de').all).toHaveLength(300);
  });
});

describe('the button versions of the drag (phone): one way to change a layout', () => {
  const keysOf = (d: Doc, tab = 0): string[][] =>
    (buildFieldHub(file(d), 'baum', 'de').tabs[tab]?.lines ?? []).map((l) => l.map((f) => f.key));
  const firstTwo = (d: Doc): [string, string] => {
    const lines = keysOf(d);
    return [lines[0]?.[0] as string, lines[1]?.[0] as string];
  };

  it('up and down swap a card with the neighbouring line; the ends cannot move further', () => {
    const doc = open();
    const [a, b] = firstTwo(doc);
    expect(reach(file(doc), 'baum', a, 'de')).toEqual({ up: false, down: true });
    expect(moveLineOps(file(doc), 'baum', a, -1, 'de')).toEqual([]);
    const down = take(doc, ...moveLineOps(file(doc), 'baum', a, 1, 'de'));
    expect(keysOf(down).slice(0, 2).flat()).toEqual([b, a]);
    const up = take(down, ...moveLineOps(file(down), 'baum', a, -1, 'de'));
    expect(keysOf(up).slice(0, 2).flat()).toEqual([a, b]);
  });

  it('left and right pair a card with the line above; full width takes it out of the pair again', () => {
    let doc = open();
    const [a, b] = firstTwo(doc);
    doc = take(doc, ...setColumnOps(file(doc), 'baum', b, 'right', 'de'));
    expect(keysOf(doc)[0]).toEqual([a, b]);
    expect(display(doc, a)?.column).toBe('left');
    expect(reach(file(doc), 'baum', b, 'de')).toEqual({ up: true, down: true });
    doc = take(doc, ...setColumnOps(file(doc), 'baum', b, 'full', 'de'));
    expect(keysOf(doc).slice(0, 2)).toEqual([[a], [b]]);
    expect(display(doc, b)?.column).toBeUndefined();
  });

  it('a card of a pair steps out into its own line with up and down', () => {
    let doc = open();
    const [a, b] = firstTwo(doc);
    doc = take(doc, ...setColumnOps(file(doc), 'baum', b, 'left', 'de'));
    doc = take(doc, ...moveLineOps(file(doc), 'baum', b, 1, 'de'));
    expect(keysOf(doc).slice(0, 2)).toEqual([[a], [b]]);
  });

  it('"In Tab verschieben" is the tab drop; null is Ausgeblendet', () => {
    let doc = open();
    const [a, b] = firstTwo(doc);
    doc = take(doc, ...moveToTabOps(file(doc), 'baum', a, 'Messung', 'de'));
    expect(buildFieldHub(file(doc), 'baum', 'de').tabs.map((t) => t.name)).toEqual([
      HUB_DEFAULT_TAB,
      'Messung',
    ]);
    doc = take(doc, ...moveToTabOps(file(doc), 'baum', b, null, 'de'));
    expect(buildFieldHub(file(doc), 'baum', 'de').hidden.map((f) => f.key)).toEqual([b]);
  });
});

describe('the Daten tabs of the stage pane (WP-444): the same ops as the hub', () => {
  const tabsOf = (d: Doc): Record<string, string[]> =>
    Object.fromEntries(
      buildFieldHub(file(d), 'baum', 'de').tabs.map((t) => [t.name, t.lines.flat().map((f) => f.key)]),
    );
  const keys = (d: Doc): string[] => buildFieldHub(file(d), 'baum', 'de').all.map((f) => f.key);

  it('putting a property into a new tab writes display.tab and a tab_order after the existing tabs', () => {
    let doc = open();
    const [a, b] = keys(doc);
    doc = take(doc, ...addToTabOps(file(doc), 'baum', a as string, 'Messung', 'de'));
    expect(display(doc, a as string)).toMatchObject({ tab: { de: 'Messung' }, tab_order: 1 });
    doc = take(doc, ...addToTabOps(file(doc), 'baum', b as string, 'Pflege', 'de'));
    expect(display(doc, b as string)?.tab_order).toBe(2);
    // a second property of an existing tab reuses its order
    const c = keys(doc)[2] as string;
    doc = take(doc, ...addToTabOps(file(doc), 'baum', c, 'Messung', 'de'));
    expect(display(doc, c)?.tab_order).toBe(1);
    expect(Object.keys(tabsOf(doc))).toEqual([HUB_DEFAULT_TAB, 'Messung', 'Pflege']);
  });

  it('renaming a tab renames it on every property, hidden ones included', () => {
    let doc = open();
    const [a, b] = keys(doc) as [string, string];
    doc = take(doc, ...addToTabOps(file(doc), 'baum', a, 'Messung', 'de'));
    doc = take(doc, ...addToTabOps(file(doc), 'baum', b, 'Messung', 'de'));
    doc = take(doc, hideOp(file(doc), 'baum', b));
    doc = take(doc, ...renameTabOps(file(doc), 'baum', 'Messung', 'Werte', 'de'));
    expect(display(doc, a)?.tab).toEqual({ de: 'Werte' });
    expect(display(doc, b)?.tab).toEqual({ de: 'Werte' });
    expect(display(doc, a)?.tab_order).toBe(1);
    expect(tabsOf(doc)['Werte']).toEqual([a]);
    expect(renameTabOps(file(doc), 'baum', 'Werte', ' ', 'de')).toEqual([]);
    expect(renameTabOps(file(doc), 'baum', 'Werte', 'Werte', 'de')).toEqual([]);
  });

  it('deleting a tab leaves its properties without a tab, as new last rows of the default tab', () => {
    let doc = open();
    const before = tabsOf(doc)[HUB_DEFAULT_TAB] as string[];
    const [a, b] = before as [string, string];
    doc = take(doc, ...addToTabOps(file(doc), 'baum', a, 'Messung', 'de'));
    doc = take(doc, ...addToTabOps(file(doc), 'baum', b, 'Messung', 'de'));
    doc = take(doc, ...addToTabOps(file(doc), 'baum', before[2] as string, 'Messung', 'de'));
    doc = take(doc, ...deleteTabOps(file(doc), 'baum', 'Messung', 'de'));
    for (const k of [a, b, before[2] as string]) {
      expect(display(doc, k)?.tab).toBeUndefined();
      expect(display(doc, k)?.tab_order).toBeUndefined();
    }
    expect(Object.keys(tabsOf(doc))).toEqual([HUB_DEFAULT_TAB]);
    expect([...(tabsOf(doc)[HUB_DEFAULT_TAB] as string[])].sort()).toEqual([...before].sort());
    expect((tabsOf(doc)[HUB_DEFAULT_TAB] as string[]).slice(0, 3)).toEqual([a, b, before[2]]);
  });

  it('"Aus Tab entfernen" sends one property back to the default tab', () => {
    let doc = open();
    const [a, b] = keys(doc) as [string, string];
    doc = take(doc, ...addToTabOps(file(doc), 'baum', a, 'Messung', 'de'));
    doc = take(doc, ...addToTabOps(file(doc), 'baum', b, 'Messung', 'de'));
    doc = take(doc, ...removeFromTabOps(file(doc), 'baum', a, 'de'));
    expect(display(doc, a)?.tab).toBeUndefined();
    expect(tabsOf(doc)['Messung']).toEqual([b]);
  });

  it('a new tab gets a name no tab has', () => {
    expect(newTabName(['', 'Neuer Tab'], 'Neuer Tab')).toBe('Neuer Tab 2');
    expect(newTabName([''], 'Neuer Tab')).toBe('Neuer Tab');
  });

  it('"In Daten-Tabs ausgeblendet" writes and reads display.hidden', () => {
    let doc = open();
    const a = keys(doc)[0] as string;
    doc = take(doc, setHiddenOp(file(doc), 'baum', a, true));
    expect(display(doc, a)?.hidden).toBe(true);
    expect(buildFieldHub(file(doc), 'baum', 'de').hidden.map((f) => f.key)).toContain(a);
    doc = take(doc, setHiddenOp(file(doc), 'baum', a, false));
    expect(display(doc, a)?.hidden).toBeUndefined();
    expect(buildFieldHub(file(doc), 'baum', 'de').hidden).toEqual([]);
  });

  it('property: any tab edit keeps the file valid', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(5), fc.constantFrom('A', 'B', 'C', ''), fc.boolean()), { maxLength: 8 }),
        fc.constantFrom('A', 'B', 'C'),
        (moves, victim) => {
          let doc = open();
          const all = keys(doc);
          for (const [i, tab, hide] of moves) {
            const k = all[i % all.length] as string;
            doc = take(doc, ...addToTabOps(file(doc), 'baum', k, tab, 'de'));
            if (hide) doc = take(doc, setHiddenOp(file(doc), 'baum', k, true));
          }
          doc = take(doc, ...renameTabOps(file(doc), 'baum', victim, `${victim}x`, 'de'));
          doc = take(doc, ...deleteTabOps(file(doc), 'baum', `${victim}x`, 'de'));
          expect(Object.keys(tabsOf(doc))).not.toContain(`${victim}x`);
        },
      ),
      { numRuns: 25 },
    );
  });
});
