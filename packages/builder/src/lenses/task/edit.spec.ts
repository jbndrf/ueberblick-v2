import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FormFieldSchema } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { goldenDoc, must } from '../process/fixtures';
import { chipsOfSource } from '../../shell/conditions';
import {
  addFieldOps,
  clearOps,
  moveStep,
  planEdit,
  removeFieldOps,
  removeStep,
  setFieldAttrOps,
  setOnOps,
  setThenOps,
  setWhenOps,
  stepOf,
  type Step,
} from './edit';
import { buildTask, textValue, valueText } from './model';
import { localizedText, withLocalized, withPage } from './edit';
import { FIELD_ATTRIBUTES } from './attributes';

const doc = () => goldenDoc('baumkataster', '2.0.0');

/** Applies a successful plan's ops to `d` the way the shell does. */
function run(d: Doc, ops: readonly Op[]): Doc {
  return ops.reduce((cur, op) => cur.apply(op).doc, d);
}

describe('buildTask', () => {
  it('reads on, when, form and then of a task', () => {
    const t = must(buildTask(doc(), 'kontrolle', 'en'));
    expect(t.label).toBe('Perform inspection');
    expect(t.on).toEqual({ kind: 'types', types: ['baum'] });
    expect(t.formType).toBe('baum');
    expect(t.fields.map((f) => f.key)).toEqual(['vitalitaet', 'befund', 'foto', 'hoehe_m', 'hoehe_klasse']);
    expect(t.fields[2]?.entry.tool).toBe('photo');
    expect(t.fields[0]?.options.length).toBeGreaterThan(0);
    expect(t.steps).toHaveLength(5);
    expect(t.steps[1]?.when?.source).toBe("form.vitalitaet >= 'v3'");
    expect(t.steps[1]?.when?.chips.ok).toBe(true);
    expect(t.steps[2]?.otherwise).toBe(true);
    expect(t.steps[4]?.set).toEqual([{ key: 'kontrolle_faellig', text: 'false', value: false }]);
    expect(t.addable.map((a) => a.key)).not.toContain('befund');
    expect(t.paths).toContain('self.vitalitaet');
    expect(t.paths).toContain('form.befund');
  });

  it('shows a special offer and the created type', () => {
    const t = must(buildTask(doc(), 'erfassen', 'en'));
    expect(t.on).toEqual({ kind: 'offer', offer: '$map' });
    expect(t.formType).toBe('baum');
    expect(must(buildTask(doc(), 'baumart_anlegen', 'de')).formType).toBe('baumart');
  });

  it('shows a complex condition as text (chips only where core can)', () => {
    const complex = run(doc(), [
      { kind: 'set', path: 'tasks.kontrolle.when', value: "self.befund.contains('x')" },
    ]);
    expect(must(buildTask(complex, 'kontrolle', 'en')).when?.chips.ok).toBe(false);
    expect(must(buildTask(doc(), 'massnahme_anlegen', 'en')).when?.chips).toEqual({
      ok: true,
      chips: [{ kind: 'compare', left: 'self.stage', op: '==', right: 'massnahme' }],
    });
  });

  it('is undefined for a task the file lacks', () => {
    expect(buildTask(doc(), 'nix', 'en')).toBeUndefined();
  });

  it('keeps the attribute table in step with the file schema', () => {
    // column and row are the form editor's layout (WP-450), not an attribute of the lens card
    const layout = new Set(['column', 'row']);
    const keys = Object.keys(FormFieldSchema.shape).filter((k) => !layout.has(k));
    expect([...FIELD_ATTRIBUTES.map((a) => a.key)].sort()).toEqual(keys.sort());
  });

  it('a set value typed as text keeps literals literal', () => {
    for (const v of [true, false, null, 3, 1.5, "'x'", 'today()', 'self.a + 1']) {
      expect(textValue(valueText(v))).toEqual(v);
    }
  });
});

describe('edits go through Doc.apply', () => {
  it('a chip edit of a task condition is one override, and the chips come back', () => {
    const d = doc();
    const plan = planEdit(
      d,
      setWhenOps(d, 'massnahme_anlegen', "self.stage == 'geprueft'"),
      'tasks.massnahme_anlegen.when',
      'en',
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.doc.overlay().override?.['tasks.massnahme_anlegen.when']).toBe("self.stage == 'geprueft'");
    const t = must(buildTask(plan.doc, 'massnahme_anlegen', 'en'));
    expect(t.when?.chips).toEqual(chipsOfSource("self.stage == 'geprueft'"));
  });

  it('a condition core rejects is refused with the problem and changes nothing', () => {
    const d = doc();
    const plan = planEdit(
      d,
      setWhenOps(d, 'massnahme_anlegen', 'self.stage =='),
      'tasks.massnahme_anlegen.when',
      'en',
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('problem');
    const unknown = planEdit(
      d,
      setWhenOps(d, 'massnahme_anlegen', 'self.gibtsnicht == 1'),
      'tasks.massnahme_anlegen.when',
      'en',
    );
    expect(unknown.ok).toBe(false);
  });

  it('an edit that changes nothing says so', () => {
    const d = doc();
    const same = must(d.effective().tasks?.massnahme_anlegen?.when);
    const plan = planEdit(d, setWhenOps(d, 'massnahme_anlegen', same), 'tasks.massnahme_anlegen.when', 'en');
    expect(plan).toEqual({ ok: false, reason: 'no_effect' });
  });

  it('a refused op is reported with its reason', () => {
    const plan = planEdit(doc(), [{ kind: 'set', path: 'not a path!', value: 1 }], 'tasks', 'en');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('refused');
  });

  it('an empty condition removes the task condition, and it can be set again', () => {
    const d = doc();
    const cleared = planEdit(d, setWhenOps(d, 'massnahme_anlegen', ''), 'tasks.massnahme_anlegen.when', 'en');
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.doc.effective().tasks?.massnahme_anlegen?.when).toBeUndefined();
    const again = planEdit(
      cleared.doc,
      setWhenOps(cleared.doc, 'massnahme_anlegen', "self.stage == 'massnahme'"),
      'tasks.massnahme_anlegen.when',
      'en',
    );
    expect(again.ok).toBe(true);
    if (again.ok)
      expect(again.doc.effective().tasks?.massnahme_anlegen?.when).toBe("self.stage == 'massnahme'");
  });

  it('changes where a task is offered', () => {
    const d = doc();
    const plan = planEdit(d, setOnOps(d, 'verschieben', ['baum', 'flaeche']), 'tasks.verschieben', 'en');
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.doc.effective().tasks?.verschieben?.on).toEqual(['baum', 'flaeche']);
  });

  it('sets, changes and removes a form field attribute, and re-sets a removed one', () => {
    let d = doc();
    const step = (ops: readonly Op[]) => {
      const p = planEdit(d, ops, 'tasks.kontrolle.form', 'en');
      expect(p.ok).toBe(true);
      if (p.ok) d = p.doc;
    };
    step(setFieldAttrOps(d, 'kontrolle', 'befund', 'relevant', "form.vitalitaet >= 'v2'"));
    expect(d.effective().tasks?.kontrolle?.form?.befund?.relevant).toBe("form.vitalitaet >= 'v2'");
    step(setFieldAttrOps(d, 'kontrolle', 'befund', 'required', undefined));
    expect(d.effective().tasks?.kontrolle?.form?.befund?.required).toBeUndefined();
    step(setFieldAttrOps(d, 'kontrolle', 'befund', 'required', true));
    expect(d.effective().tasks?.kontrolle?.form?.befund?.required).toBe(true);
    step(setFieldAttrOps(d, 'kontrolle', 'befund', 'relevant', undefined));
    expect(d.effective().tasks?.kontrolle?.form?.befund?.relevant).toBeUndefined();
  });

  it('edits the page and the placeholder of a field and reads them back (WP-672)', () => {
    let d = doc();
    const step = (ops: readonly Op[]) => {
      const p = planEdit(d, ops, 'tasks.kontrolle.form', 'en');
      expect(p.ok).toBe(true);
      if (p.ok) d = p.doc;
    };
    const entry = () => d.effective().tasks?.kontrolle?.form?.befund as Record<string, unknown> | undefined;
    step(
      setFieldAttrOps(d, 'kontrolle', 'befund', 'placeholder', withLocalized(undefined, 'en', 'e.g. Oak')),
    );
    expect(entry()?.placeholder).toEqual({ en: 'e.g. Oak' });
    step(setFieldAttrOps(d, 'kontrolle', 'befund', 'page', withPage(undefined, 'en', 'label', 'Findings')));
    expect(entry()?.page).toEqual({ label: { en: 'Findings' } });
    step(
      setFieldAttrOps(d, 'kontrolle', 'befund', 'page', withPage(entry()?.page, 'en', 'hint', 'Describe.')),
    );
    expect(entry()?.page).toEqual({ label: { en: 'Findings' }, hint: { en: 'Describe.' } });
    step(setFieldAttrOps(d, 'kontrolle', 'befund', 'page', withPage(entry()?.page, 'en', 'label', '')));
    expect(entry()?.page).toEqual({ hint: { en: 'Describe.' } });
    step(setFieldAttrOps(d, 'kontrolle', 'befund', 'page', withPage({ hint: 'x' }, 'en', 'hint', '')));
    expect(entry()?.page).toEqual({});
    step(setFieldAttrOps(d, 'kontrolle', 'befund', 'page', undefined));
    expect(entry()?.page).toBeUndefined();
    expect(buildTask(d, 'kontrolle', 'en')).toBeDefined();
  });

  it('adds a field for a property, removes it, and puts a removed template field back', () => {
    let d = doc();
    const t = must(buildTask(d, 'befund_ergaenzen', 'en'));
    const prop = must(t.addable[0]).key;
    const added = planEdit(d, addFieldOps(d, 'befund_ergaenzen', prop), 'tasks.befund_ergaenzen.form', 'en');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    d = added.doc;
    expect(Object.keys(d.effective().tasks?.befund_ergaenzen?.form ?? {})).toContain(prop);
    const removed = planEdit(
      d,
      removeFieldOps(d, 'befund_ergaenzen', prop),
      'tasks.befund_ergaenzen.form',
      'en',
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(Object.keys(removed.doc.effective().tasks?.befund_ergaenzen?.form ?? {})).not.toContain(prop);
    // a template field: hide, then add it back
    const hid = planEdit(
      d,
      removeFieldOps(d, 'befund_ergaenzen', 'befund'),
      'tasks.befund_ergaenzen.form',
      'en',
    );
    expect(hid.ok).toBe(true);
    if (!hid.ok) return;
    const back = planEdit(
      hid.doc,
      addFieldOps(hid.doc, 'befund_ergaenzen', 'befund'),
      'tasks.befund_ergaenzen.form',
      'en',
    );
    expect(back.ok).toBe(true);
    if (back.ok)
      expect(Object.keys(back.doc.effective().tasks?.befund_ergaenzen?.form ?? {})).toContain('befund');
  });

  it('a field for a property the type lacks is refused with the problem', () => {
    const d = doc();
    const plan = planEdit(
      d,
      addFieldOps(d, 'befund_ergaenzen', 'gibtsnicht'),
      'tasks.befund_ergaenzen.form',
      'en',
    );
    expect(plan.ok).toBe(false);
  });

  it('clearing an overridden template value hides it, so the template value does not come back', () => {
    const d0 = doc();
    const a = planEdit(d0, setWhenOps(d0, 'massnahme_anlegen', "self.stage == 'geprueft'"), 'tasks', 'en');
    if (!a.ok) throw new Error('setup');
    expect(clearOps(a.doc, 'tasks.massnahme_anlegen.when').map((o) => o.kind)).toEqual(['reset', 'hide']);
    const b = planEdit(a.doc, setWhenOps(a.doc, 'massnahme_anlegen', ''), 'tasks', 'en');
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.doc.effective().tasks?.massnahme_anlegen?.when).toBeUndefined();
  });
});

describe('then steps', () => {
  const steps = (): readonly Step[] => must(buildTask(doc(), 'kontrolle', 'en')).steps.map(stepOf);

  it('reads back to the same steps the file has', () => {
    expect(steps()).toEqual(must(doc().effective().tasks?.kontrolle?.then));
  });

  it('a changed step is one op on the whole list, and the effective file has it', () => {
    const d = doc();
    const edited = steps().map((s, i) => (i === 4 ? { set: { kontrolle_faellig: true } } : s));
    const plan = planEdit(d, setThenOps(d, 'kontrolle', edited), 'tasks.kontrolle.then', 'en');
    expect(plan.ok).toBe(true);
    if (plan.ok)
      expect(plan.doc.effective().tasks?.kontrolle?.then?.[4]?.set).toEqual({ kontrolle_faellig: true });
  });

  it('a step that sets a property the type lacks is refused', () => {
    const d = doc();
    const plan = planEdit(
      d,
      setThenOps(d, 'kontrolle', [{ set: { gibtsnicht: '1' } }]),
      'tasks.kontrolle.then',
      'en',
    );
    expect(plan.ok).toBe(false);
  });

  it('move and remove keep the other steps (property)', () => {
    fc.assert(
      fc.property(fc.nat(6), fc.constantFrom(-1 as const, 1 as const), (i, by) => {
        const s = steps();
        const moved = moveStep(s, i, by);
        expect(moved).toHaveLength(s.length);
        expect([...moved].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
          [...s].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        );
        if (i < s.length) expect(removeStep(s, i)).toHaveLength(s.length - 1);
      }),
    );
  });

  it('removing every step removes then', () => {
    const d = doc();
    const plan = planEdit(d, setThenOps(d, 'kontrolle', []), 'tasks.kontrolle.then', 'en');
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.doc.effective().tasks?.kontrolle?.then).toBeUndefined();
  });

  it('a whole run of ops equals applying them one after another', () => {
    const d = doc();
    const ops = setFieldAttrOps(d, 'kontrolle', 'befund', 'required', false);
    const plan = planEdit(d, ops, 'tasks.kontrolle.form', 'en');
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.doc.save().overlaySrc).toBe(run(d, ops).save().overlaySrc);
  });
});

describe('localized attributes', () => {
  it('keeps the other languages and removes only the typed one', () => {
    expect(withLocalized({ de: 'A', en: 'B' }, 'en', 'C')).toEqual({ de: 'A', en: 'C' });
    expect(withLocalized({ de: 'A', en: 'B' }, 'en', '')).toEqual({ de: 'A' });
    expect(withLocalized({ en: 'B' }, 'en-GB', '')).toBeUndefined();
    expect(withLocalized(undefined, 'de', 'Hallo')).toEqual({ de: 'Hallo' });
    expect(withLocalized(undefined, 'de', ' ')).toBeUndefined();
    expect(withLocalized('Plain', 'de', 'Neu')).toBe('Neu');
  });

  it('reads the text of a language, its base language, or nothing', () => {
    expect(localizedText({ de: 'A' }, 'de-AT')).toBe('A');
    expect(localizedText({ de: 'A' }, 'en')).toBe('');
    expect(localizedText('X', 'en')).toBe('X');
    expect(localizedText(undefined, 'en')).toBe('');
  });
});
