// WP-393: v3's Smart Dropdown as the `choice_filter` of docs/05: written from the checklist, read back, compiled.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc, type Op } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { addOptionOp } from '../field/ops';
import {
  choiceFilterOf,
  choiceOps,
  parseChoiceFilter,
  smartFilter,
  smartSourcesOf,
  toggleOption,
  type ChoiceBranch,
  type ChoiceFilter,
} from './choice';
import { formOf } from './model';
import { newFieldOps } from './ops';
import { PALETTE_TILES } from './palette';

const T = 'kontrolle';
const TYPE = 'baum';
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
const smart = (doc: Doc): { doc: Doc; key: string } => {
  const tile = PALETTE_TILES.find((x) => x.key === 'smart_dropdown');
  if (tile === undefined) throw new Error('no tile');
  const made = newFieldOps(doc, T, TYPE, tile, 'Neu', 'de', { kind: 'page', page: 0 });
  return { doc: apply(doc, made.ops), key: made.key };
};

describe('parse and write', () => {
  it('true is an open filter, no filter is none', () => {
    expect(parseChoiceFilter(undefined)).toEqual({ kind: 'none' });
    expect(parseChoiceFilter('true')).toEqual({ kind: 'open' });
  });

  it('writes one branch per source value, ending in false, and reads it back', () => {
    const f: ChoiceFilter = {
      kind: 'smart',
      source: 'vitalitaet',
      branches: [
        { when: 'v0', options: ['a', 'b'] },
        { when: 'v1', options: ['c'] },
      ],
    };
    const src = choiceFilterOf(f, false);
    expect(src).toBe(
      "form.vitalitaet == 'v0' ? option in ['a', 'b'] : form.vitalitaet == 'v1' ? option in ['c'] : false",
    );
    expect(parseChoiceFilter(src)).toEqual(f);
  });

  it('a multiselect source uses `in`', () => {
    const f: ChoiceFilter = { kind: 'smart', source: 'q', branches: [{ when: 'x', options: ['a'] }] };
    const src = choiceFilterOf(f, true);
    expect(src).toBe("'x' in form.q ? option in ['a'] : false");
    expect(parseChoiceFilter(src)).toEqual(f);
  });

  it('a source without a checklist is a real branch with an empty list and keeps its source', () => {
    const f: ChoiceFilter = { kind: 'smart', source: 'q', branches: [{ when: 'v0', options: [] }] };
    const src = choiceFilterOf(f, false);
    expect(src).toBe("form.q == 'v0' ? option in [] : false");
    expect(parseChoiceFilter(src)).toEqual(f);
    const m: ChoiceFilter = { kind: 'smart', source: 'q', branches: [{ when: 'v0', options: [] }] };
    expect(choiceFilterOf(m, true)).toBe("'v0' in form.q ? option in [] : false");
    expect(parseChoiceFilter(choiceFilterOf(m, true))).toEqual(m);
  });

  it('a fresh filter seeds an empty branch under the first source option; no option stays open', () => {
    const src = { key: 'q', label: 'Q', multi: false, page: 0 };
    const o = (key: string) => ({ key, label: key, hint: '' });
    expect(smartFilter({ ...src, options: [o('v0'), o('v1')] })).toEqual({
      kind: 'smart',
      source: 'q',
      branches: [{ when: 'v0', options: [] }],
    });
    expect(smartFilter({ ...src, options: [] })).toEqual({ kind: 'open' });
  });

  it('an expression of another shape is foreign and stays as the file has it', () => {
    for (const src of [
      "form.a == 'x' ? option in ['a'] : option == 'b'",
      "form.a == 'x' ? option in ['a'] : form.b == 'y' ? option in ['b'] : false",
      "option != 'kiefer'",
      "form.gruppe == 'laub' ? option != 'kiefer' : option == 'kiefer'",
    ])
      expect(parseChoiceFilter(src), src).toEqual({ kind: 'foreign', expr: src });
  });

  it('property: reading back what was written gives the same filter', () => {
    const word = fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/);
    const branch = fc.record({
      when: word,
      options: fc.uniqueArray(word, { minLength: 0, maxLength: 4 }),
    });
    fc.assert(
      fc.property(
        word,
        fc.uniqueArray(branch, { selector: (b) => b.when, minLength: 1, maxLength: 4 }),
        fc.boolean(),
        (source, branches, multi) => {
          const [head, ...tail] = branches;
          const f: ChoiceFilter = { kind: 'smart', source, branches: [head as ChoiceBranch, ...tail] };
          expect(parseChoiceFilter(choiceFilterOf(f, multi))).toEqual(f);
        },
      ),
    );
  });

  it('property: any checklist state, including all branches empty, survives write and read', () => {
    const word = fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/);
    fc.assert(
      fc.property(
        word,
        fc.uniqueArray(word, { minLength: 1, maxLength: 4 }),
        fc.boolean(),
        (source, whens, multi) => {
          const [head, ...tail] = whens.map((when) => ({ when, options: [] as string[] }));
          const f: ChoiceFilter = { kind: 'smart', source, branches: [head as ChoiceBranch, ...tail] };
          const src = choiceFilterOf(f, multi);
          expect(src).not.toContain('null');
          expect(parseChoiceFilter(src)).toEqual(f);
        },
      ),
    );
  });

  it('a key with a quote or a backslash survives', () => {
    const f: ChoiceFilter = {
      kind: 'smart',
      source: 'q',
      branches: [{ when: "it's", options: ['a\\b'] }],
    };
    expect(parseChoiceFilter(choiceFilterOf(f, false))).toEqual(f);
  });
});

describe('toggling a checklist', () => {
  const base: ChoiceFilter = { kind: 'smart', source: 'q', branches: [{ when: 'v0', options: ['b'] }] };
  const order = ['a', 'b', 'c'];

  it('adds an option in the order of the field, and keeps an emptied branch (it offers nothing)', () => {
    const on = toggleOption(base, 'v0', 'a', true, order);
    expect(on).toEqual({ kind: 'smart', source: 'q', branches: [{ when: 'v0', options: ['a', 'b'] }] });
    const off = toggleOption(toggleOption(on, 'v0', 'a', false, order), 'v0', 'b', false, order);
    expect(off).toEqual({ kind: 'smart', source: 'q', branches: [{ when: 'v0', options: [] }] });
  });

  it('a new source value gets a new branch', () => {
    const f = toggleOption(base, 'v1', 'c', true, order);
    expect(f.kind === 'smart' && f.branches.map((b) => b.when)).toEqual(['v0', 'v1']);
  });
});

describe('through the file', () => {
  it('the palette makes a select with an open filter in the form', () => {
    const { doc, key: k } = smart(open());
    const file = doc.effective();
    expect(file.types?.[TYPE]?.properties[k]?.type).toBe('select');
    expect(formOf(file, T)[k]?.choice_filter).toBe('true');
    expect(parseChoiceFilter(formOf(file, T)[k]?.choice_filter)).toEqual({ kind: 'open' });
  });

  it('the sources are the selects earlier in the form, with their options', () => {
    const { doc, key: k } = smart(open());
    const sources = smartSourcesOf(doc.effective(), T, TYPE, k, 'de');
    expect(sources.map((s) => s.key)).toContain('vitalitaet');
    expect(sources.map((s) => s.key)).not.toContain(k);
    expect(sources.find((s) => s.key === 'vitalitaet')?.options.map((o) => o.key)).toEqual([
      'v0',
      'v1',
      'v2',
      'v3',
      'v4',
    ]);
  });

  it('a written filter compiles without a new problem and reads back', () => {
    const made = smart(open());
    const withOption = apply(made.doc, [addOptionOp(made.doc.effective(), TYPE, made.key, 'Eiche', 'de')]);
    const before = new Set(withOption.problems().map(key));
    const f = toggleOption(
      { kind: 'smart', source: 'vitalitaet', branches: [{ when: 'v0', options: [] }] },
      'v0',
      'eiche',
      true,
      ['eiche'],
    );
    const written = apply(withOption, choiceOps(withOption, T, made.key, f, false));
    expect(
      written
        .problems()
        .map(key)
        .filter((p) => !before.has(p)),
    ).toEqual([]);
    expect(parseChoiceFilter(formOf(written.effective(), T)[made.key]?.choice_filter)).toEqual(f);
  });

  it('a hand-written filter is left as it is', () => {
    const made = smart(open());
    const hand = "form.vitalitaet == 'v0' ? option != 'x' : true";
    const doc = apply(made.doc, [
      { kind: 'set', path: `tasks.${T}.form.${made.key}.choice_filter`, value: hand } as Op,
    ]);
    expect(parseChoiceFilter(formOf(doc.effective(), T)[made.key]?.choice_filter)).toEqual({
      kind: 'foreign',
      expr: hand,
    });
  });
});
