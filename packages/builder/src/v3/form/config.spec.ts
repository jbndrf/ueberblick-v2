import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc, type Op } from '../../doc';
import { messages } from '../../shell/messages';
import { musterstadt } from '../../testing/golden';
import {
  calculateOf,
  fieldConfigOf,
  helpOps,
  nowSource,
  placeholderOps,
  prefillOf,
  prefillOps,
  requiredOps,
  rulesOps,
  type Prefill,
} from './config';
import { formOf } from './model';
import { newFieldOps } from './ops';
import { PALETTE_TILES } from './palette';

const T = 'kontrolle';
const TYPE = 'baum';
const t = messages('de');
const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
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
const cfg = (doc: Doc, k: string) => fieldConfigOf(doc.effective(), T, TYPE, k, 'de');
const fresh = (before: Doc, after: Doc): string[] => {
  const known = new Set(before.problems().map(key));
  return after
    .problems()
    .map(key)
    .filter((k) => !known.has(k));
};

describe('prefill and calculate', () => {
  it('reads the kind from the source: nothing, self.<key>, a literal, an expression', () => {
    expect(prefillOf(undefined, 'a')).toEqual({ kind: 'empty', text: '' });
    expect(prefillOf('self.a', 'a')).toEqual({ kind: 'last_value', text: '' });
    expect(prefillOf("'abc'", 'a')).toEqual({ kind: 'constant', text: 'abc' });
    expect(prefillOf('12', 'a')).toEqual({ kind: 'constant', text: '12' });
    expect(prefillOf('today()', 'a')).toEqual({ kind: 'computed', text: 'today()' });
    expect(prefillOf('self.b + 1', 'a')).toEqual({ kind: 'computed', text: 'self.b + 1' });
  });

  it('writes the constant as a literal of the property type', () => {
    expect(calculateOf({ kind: 'constant', text: 'abc' }, 'a', 'text')).toBe("'abc'");
    expect(calculateOf({ kind: 'constant', text: '12' }, 'a', 'number')).toBe('12');
    expect(calculateOf({ kind: 'constant', text: '12' }, 'a', 'text')).toBe("'12'");
    expect(calculateOf({ kind: 'constant', text: 'true' }, 'a', 'boolean')).toBe('true');
    expect(calculateOf({ kind: 'constant', text: '' }, 'a', 'text')).toBeUndefined();
    expect(calculateOf({ kind: 'empty', text: 'x' }, 'a', 'text')).toBeUndefined();
  });

  it('property: a constant reads back as the same kind and text', () => {
    const kinds = fc.constantFrom('text', 'number', 'integer', 'boolean', 'select');
    fc.assert(
      fc.property(kinds, fc.string({ minLength: 1, maxLength: 12 }), (type, raw) => {
        const prefill: Prefill = { kind: 'constant', text: raw };
        const source = calculateOf(prefill, 'a', type as never);
        if (source === undefined) return;
        const back = prefillOf(source, 'a');
        // a text that is a number in a number property reads back as the number's text; that is the same value
        if (back.kind === 'constant') expect(calculateOf(back, 'a', type as never)).toBe(source);
      }),
    );
  });

  it('date: "now" is today() for a date and now for a point in time', () => {
    expect(nowSource('date')).toBe('today()');
    expect(nowSource('datetime')).toBe('now');
    expect(nowSource('time')).toBeUndefined();
  });
});

describe('Darstellung ops against musterstadt (kontrolle)', () => {
  it('placeholder round-trips through the file, per language; empty text removes it', () => {
    let doc = apply(open(), placeholderOps(open(), T, 'befund', 'de', 'z. B. Pilzbefall'));
    expect(formOf(doc.effective(), T)['befund']?.placeholder).toEqual({ de: 'z. B. Pilzbefall' });
    expect(cfg(reloaded(doc), 'befund').placeholder).toBe('z. B. Pilzbefall');
    doc = apply(doc, placeholderOps(doc, T, 'befund', 'en', 'e.g. fungus'));
    expect(formOf(doc.effective(), T)['befund']?.placeholder).toEqual({
      de: 'z. B. Pilzbefall',
      en: 'e.g. fungus',
    });
    doc = apply(doc, placeholderOps(doc, T, 'befund', 'de', ''));
    doc = apply(doc, placeholderOps(doc, T, 'befund', 'en', ''));
    expect(formOf(doc.effective(), T)['befund']?.placeholder).toBeUndefined();
    expect(fresh(open(), doc)).toEqual([]);
  });

  it('the help text is the description of the property', () => {
    const doc = apply(open(), helpOps(open(), TYPE, 'befund', 'de', 'Was fällt auf?'));
    expect(doc.effective().types?.[TYPE]?.properties['befund']?.description).toEqual({
      de: 'Was fällt auf?',
    });
    expect(cfg(reloaded(doc), 'befund').help).toBe('Was fällt auf?');
    const cleared = apply(doc, helpOps(doc, TYPE, 'befund', 'de', ''));
    expect(cleared.effective().types?.[TYPE]?.properties['befund']?.description).toBeUndefined();
  });

  it('required is the form entry; it can be switched off again', () => {
    let doc = apply(open(), requiredOps(open(), T, 'hoehe_m', true));
    expect(formOf(doc.effective(), T)['hoehe_m']?.required).toBe(true);
    expect(cfg(reloaded(doc), 'hoehe_m').required).toBe(true);
    doc = apply(doc, requiredOps(doc, T, 'hoehe_m', false));
    expect(formOf(doc.effective(), T)['hoehe_m']?.required).toBeUndefined();
  });

  it('a prefill of each kind is written as calculate; empty removes it', () => {
    let doc = open();
    const set = (p: Prefill) => (doc = apply(doc, prefillOps(doc, T, 'befund', TYPE, p, 'de', t)));
    set({ kind: 'last_value', text: '' });
    expect(formOf(doc.effective(), T)['befund']?.calculate).toBe('self.befund');
    set({ kind: 'constant', text: 'in Ordnung' });
    expect(formOf(doc.effective(), T)['befund']?.calculate).toBe("'in Ordnung'");
    set({ kind: 'computed', text: "'Kontrolle ' + string(today())" });
    expect(cfg(reloaded(doc), 'befund').prefill.kind).toBe('computed');
    set({ kind: 'empty', text: '' });
    expect(formOf(doc.effective(), T)['befund']?.calculate).toBeUndefined();
  });

  it('"Änderung erforderlich" is a constraint on the prefill and goes with it', () => {
    let doc = open();
    // hoehe_m has a constraint of its own: not touched, ops are empty
    expect(rulesOps(doc, T, 'hoehe_m', TYPE, { change: true }, 'de', t)).toEqual([]);
    doc = apply(doc, prefillOps(doc, T, 'foto', TYPE, { kind: 'last_value', text: '' }, 'de', t));
    doc = apply(doc, rulesOps(doc, T, 'foto', TYPE, { change: true }, 'de', t));
    const entry = formOf(doc.effective(), T)['foto'];
    expect(entry?.constraint).toBe('value != self.foto');
    expect(entry?.constraint_message).toEqual({ de: 'Der Wert muss geändert werden' });
    expect(cfg(reloaded(doc), 'foto').constraint).toEqual({ foreign: false, rules: { change: true } });
    // the prefill changes: the constraint follows it
    doc = apply(doc, prefillOps(doc, T, 'foto', TYPE, { kind: 'constant', text: 'x' }, 'de', t));
    expect(formOf(doc.effective(), T)['foto']?.constraint).toBe("value != 'x'");
    // no prefill: no rule
    doc = apply(doc, prefillOps(doc, T, 'foto', TYPE, { kind: 'empty', text: '' }, 'de', t));
    const after = formOf(doc.effective(), T)['foto'];
    expect(after?.constraint).toBeUndefined();
    expect(after?.constraint_message).toBeUndefined();
  });

  it('length rules are one constraint with a message; both limits and the change rule combine', () => {
    let doc = open();
    doc = apply(doc, rulesOps(doc, T, 'vitalitaet', TYPE, { minLength: 2 }, 'de', t));
    expect(formOf(doc.effective(), T)['vitalitaet']?.constraint).toBe('size(value) >= 2');
    doc = apply(doc, rulesOps(doc, T, 'vitalitaet', TYPE, { maxLength: 8 }, 'de', t));
    expect(formOf(doc.effective(), T)['vitalitaet']?.constraint).toBe('size(value) >= 2 && size(value) <= 8');
    doc = apply(doc, rulesOps(doc, T, 'vitalitaet', TYPE, { change: true }, 'de', t));
    expect(formOf(doc.effective(), T)['vitalitaet']?.constraint).toBe(
      'size(value) >= 2 && size(value) <= 8 && value != self.vitalitaet',
    );
    expect(cfg(reloaded(doc), 'vitalitaet').constraint).toEqual({
      foreign: false,
      rules: { minLength: 2, maxLength: 8, change: true },
    });
    doc = apply(
      doc,
      rulesOps(
        doc,
        T,
        'vitalitaet',
        TYPE,
        { minLength: undefined, maxLength: undefined, change: undefined },
        'de',
        t,
      ),
    );
    expect(formOf(doc.effective(), T)['vitalitaet']?.constraint).toBeUndefined();
  });

  it('a pattern and a step are one constraint with the other rules, a message, and compile without a problem', () => {
    const base = open();
    let doc = base;
    doc = apply(doc, rulesOps(doc, T, 'foto', TYPE, { minLength: 2, pattern: '^[A-Z]{2}\\d+$' }, 'de', t));
    const foto = formOf(doc.effective(), T)['foto'];
    expect(foto?.constraint).toBe("size(value) >= 2 && matches(value, '^[A-Z]{2}\\\\d+$')");
    expect(foto?.constraint_message).toEqual({ de: 'Mindestens 2 Zeichen. Der Wert passt nicht zum Muster' });
    const tile = {
      ...(PALETTE_TILES.find((x) => x.key === 'number') as (typeof PALETTE_TILES)[number]),
      type: 'integer' as const,
    };
    const made = newFieldOps(doc, T, TYPE, tile, 'Stueckzahl', 'de', { kind: 'page', page: 0 });
    doc = apply(doc, made.ops);
    const k = made.key;
    doc = apply(doc, rulesOps(doc, T, k, TYPE, { step: 5 }, 'de', t));
    const vit = formOf(doc.effective(), T)[k];
    expect(vit?.constraint).toBe('multiple_of(value, 5)');
    expect(vit?.constraint_message).toEqual({ de: 'Der Wert muss ein Vielfaches von 5 sein' });
    expect(fresh(base, doc)).toEqual([]);
    expect(cfg(reloaded(doc), k).constraint).toEqual({ foreign: false, rules: { step: 5 } });
    doc = apply(doc, rulesOps(doc, T, k, TYPE, { step: undefined }, 'de', t));
    expect(formOf(doc.effective(), T)[k]?.constraint).toBeUndefined();
  });

  it('a pattern outside the subset and a step that is not above 0 with at most 9 places write nothing', () => {
    const doc = open();
    expect(rulesOps(doc, T, 'foto', TYPE, { pattern: '(?=a)b' }, 'de', t)).toEqual([]);
    expect(rulesOps(doc, T, 'foto', TYPE, { pattern: '(' }, 'de', t)).toEqual([]);
    expect(rulesOps(doc, T, 'foto', TYPE, { step: 0.0000000001 }, 'de', t)).toEqual([]);
    expect(rulesOps(doc, T, 'foto', TYPE, { step: -1 }, 'de', t)).toEqual([]);
    expect(rulesOps(doc, T, 'foto', TYPE, { step: 0 }, 'de', t)).toEqual([]);
  });

  it('reads the golden "value != self.befund" as nothing the panel wrote when there is no prefill', () => {
    expect(cfg(open(), 'befund').constraint).toEqual({ foreign: true });
    expect(cfg(open(), 'hoehe_m').constraint).toEqual({ foreign: true });
  });
});
