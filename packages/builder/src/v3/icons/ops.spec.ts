import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { openProject, type Doc } from '../../doc';
import { goldenProjects, musterstadt } from '../../testing/golden';
import {
  clearMarker,
  clearValueIcon,
  droppedValues,
  iconsState,
  setClassifyProperty,
  setMarker,
  setValueIcon,
  type IconEdit,
} from './ops';

const baum = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const meldung = (): Doc => {
  const p = goldenProjects.find((q) => q.name.startsWith('stadtwerke'));
  if (p === undefined) throw new Error('golden project missing');
  return openProject(p.templateSrc, p.overlaySrc);
};
const must = (r: IconEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const classifyOf = (d: Doc, t: string) => d.effective().types?.[t]?.classify;
const SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f00"/></svg>';
/** A doc whose type has no classify and no marker. */
const bare = (): Doc =>
  must(clearMarker(must(setClassifyProperty(baum(), 'baum', null, 'de')), 'baum', 'de'));
const staged = (): Doc => must(setClassifyProperty(bare(), 'baum', 'stage', 'de'));

describe('iconsState', () => {
  it('shows the classify and marker of the type with labels from options', () => {
    const s = iconsState(baum(), 'baum', 'de');
    expect(s.classify?.property).toBe('stage');
    expect(s.marker?.color).toBe('#2f855a');
    expect(s.options.map((o) => o.key)).toEqual(['erfasst', 'kontrolliert', 'massnahme', 'erledigt']);
    expect(s.options.find((o) => o.key === 'massnahme')?.label).toBe('Maßnahme');
  });

  it('offers the select properties only (stage included, no text, no file)', () => {
    expect(iconsState(baum(), 'baum', 'de').selects.map((p) => p.key)).toEqual(['stage', 'vitalitaet']);
  });

  it('is empty for a type without classify and marker', () => {
    const s = iconsState(bare(), 'baum', 'de');
    expect(s.classify).toBeNull();
    expect(s.marker).toBeNull();
    expect(s.options).toEqual([]);
  });
});

describe('setClassifyProperty', () => {
  it('"keine" removes classify', () => {
    expect(classifyOf(must(setClassifyProperty(baum(), 'baum', null, 'de')), 'baum')).toBeUndefined();
  });

  it('picking the stage property on a bare type writes classify with no values', () => {
    const d = staged();
    expect(classifyOf(d, 'baum')).toEqual({ property: 'stage', values: {} });
    expect(d.save().overlaySrc).toContain('classify');
  });

  it('refuses a property that is not a select of the type', () => {
    for (const p of ['befund', 'foto', 'nope'])
      expect(setClassifyProperty(baum(), 'baum', p, 'de')).toMatchObject({
        ok: false,
        code: 'property_invalid',
      });
  });

  it('refuses an unknown type', () => {
    expect(setClassifyProperty(baum(), 'nope', 'stage', 'de')).toMatchObject({
      ok: false,
      code: 'unknown_type',
    });
  });

  it('switching drops the entries whose option is not in the new property (meldung: kategorie to status)', () => {
    const d = meldung();
    const before = Object.keys(classifyOf(d, 'meldung')?.values ?? {});
    expect(before.length).toBeGreaterThan(0);
    expect(droppedValues(d, 'meldung', 'status')).toEqual(before);
    const next = must(setClassifyProperty(d, 'meldung', 'status', 'de'));
    expect(classifyOf(next, 'meldung')).toEqual({ property: 'status', values: {} });
  });

  it('keeps entries whose key is an option of the new property', () => {
    // vitalitaet and a second property share no key in the golden data, so the shared key is made in the overlay
    let d = must(setClassifyProperty(staged(), 'baum', 'vitalitaet', 'de'));
    d = must(setValueIcon(d, 'baum', 'v1', { color: '#00ff00', icon: { key: 'check' } }, 'de'));
    expect(droppedValues(d, 'baum', 'vitalitaet')).toEqual([]);
    d = must(setClassifyProperty(d, 'baum', 'vitalitaet', 'de'));
    expect(classifyOf(d, 'baum')?.values['v1']).toEqual({ color: '#00ff00', icon: { key: 'check' } });
  });

  it('droppedValues lists every entry for "keine" and none for the same property', () => {
    expect(droppedValues(baum(), 'baum', 'stage')).toEqual([]);
    expect(droppedValues(baum(), 'baum', null)).toEqual(
      Object.keys(classifyOf(baum(), 'baum')?.values ?? {}),
    );
  });
});

describe('setValueIcon and clearValueIcon', () => {
  it('writes colour and icon at types.<t>.classify.values.<opt> and the YAML shows it', () => {
    const d = must(
      setValueIcon(
        staged(),
        'baum',
        'massnahme',
        { color: '#112233', icon: { key: 'wrench', size: 40 } },
        'de',
      ),
    );
    expect(classifyOf(d, 'baum')?.values['massnahme']).toEqual({
      color: '#112233',
      icon: { key: 'wrench', size: 40 },
    });
    const yaml = d.save().overlaySrc;
    expect(yaml).toContain('classify');
    expect(yaml).toContain('#112233');
  });

  it('refuses a value without classify and a value that is not an option', () => {
    expect(setValueIcon(bare(), 'baum', 'erfasst', { color: '#112233' }, 'de')).toMatchObject({
      ok: false,
      code: 'no_property',
    });
    expect(setValueIcon(baum(), 'baum', 'gibtsnicht', { color: '#112233' }, 'de')).toMatchObject({
      ok: false,
      code: 'unknown_value',
    });
  });

  it('overrides a template entry and keeps the others', () => {
    const d = must(setValueIcon(baum(), 'baum', 'erfasst', { color: '#abcdef', icon: { svg: SVG } }, 'de'));
    const v = classifyOf(d, 'baum')?.values;
    expect(v?.['erfasst']).toEqual({ color: '#abcdef', icon: { svg: SVG } });
    expect(v?.['erledigt']?.color).toBe('#718096');
  });

  it("refuses invalid SVG with core's check, a size outside 8 to 128, and a bad colour", () => {
    const bad = (look: Parameters<typeof setValueIcon>[3]) =>
      setValueIcon(baum(), 'baum', 'erfasst', look, 'de');
    expect(bad({ icon: { svg: '<div>x</div>' } })).toMatchObject({ ok: false, code: 'invalid_svg' });
    expect(bad({ icon: { svg: '<svg onload="x()"></svg>' } })).toMatchObject({
      ok: false,
      code: 'invalid_svg',
    });
    expect(bad({ icon: { key: 'check', size: 7 } })).toMatchObject({ ok: false, code: 'invalid_size' });
    expect(bad({ icon: { key: 'check', size: 129 } })).toMatchObject({ ok: false, code: 'invalid_size' });
    expect(bad({ icon: { key: 'check', size: 12.5 } })).toMatchObject({ ok: false, code: 'invalid_size' });
    expect(bad({ color: 'red' })).toMatchObject({ ok: false, code: 'invalid_color' });
    expect(bad({ icon: { key: 'not-an-icon' } })).toMatchObject({ ok: false, code: 'invalid_icon' });
  });

  it('accepts the size bounds', () => {
    for (const size of [8, 128])
      expect(setValueIcon(baum(), 'baum', 'erfasst', { icon: { key: 'check', size } }, 'de').ok).toBe(true);
  });

  it('clear removes the entry; the last one leaves an empty values map; "keine" removes classify', () => {
    let d = baum();
    for (const k of ['erfasst', 'kontrolliert', 'massnahme']) d = must(clearValueIcon(d, 'baum', k, 'de'));
    expect(Object.keys(classifyOf(d, 'baum')?.values ?? {})).toEqual(['erledigt']);
    d = must(clearValueIcon(d, 'baum', 'erledigt', 'de'));
    expect(classifyOf(d, 'baum')).toEqual({ property: 'stage', values: {} });
    d = must(setClassifyProperty(d, 'baum', null, 'de'));
    expect(classifyOf(d, 'baum')).toBeUndefined();
  });

  it('clearing an entry that is not there changes nothing', () => {
    const d = baum();
    expect(must(clearValueIcon(d, 'baum', 'nope', 'de'))).toBe(d);
  });

  it('an entry set in the overlay goes away again when cleared', () => {
    const d1 = must(setValueIcon(staged(), 'baum', 'erfasst', { color: '#123456' }, 'de'));
    expect(classifyOf(must(clearValueIcon(d1, 'baum', 'erfasst', 'de')), 'baum')?.values).toEqual({});
  });
});

describe('setMarker and clearMarker', () => {
  it('writes types.<t>.marker', () => {
    const d = must(setMarker(bare(), 'baum', { color: '#445566', icon: { key: 'leaf' } }, 'de'));
    expect(d.effective().types?.['baum']?.marker).toEqual({ color: '#445566', icon: { key: 'leaf' } });
    expect(d.save().overlaySrc).toContain('#445566');
  });

  it('changes the template marker and clears it', () => {
    let d = must(setMarker(baum(), 'baum', { color: '#445566' }, 'de'));
    expect(d.effective().types?.['baum']?.marker).toEqual({ color: '#445566' });
    d = must(clearMarker(d, 'baum', 'de'));
    expect(d.effective().types?.['baum']?.marker).toBeUndefined();
  });

  it('refuses invalid input like a value icon does', () => {
    expect(setMarker(baum(), 'baum', { icon: { svg: 'nope' } }, 'de')).toMatchObject({
      ok: false,
      code: 'invalid_svg',
    });
    expect(setMarker(baum(), 'baum', { icon: { svg: SVG, size: 200 } }, 'de')).toMatchObject({
      ok: false,
      code: 'invalid_size',
    });
  });
});

describe('properties', () => {
  it('a random sequence of edits never leaves a classify or marker problem', () => {
    const op = fc.oneof(
      fc
        .constantFrom('stage', 'vitalitaet', null)
        .map((p) => (d: Doc) => setClassifyProperty(d, 'baum', p, 'de')),
      fc.tuple(fc.constantFrom('erfasst', 'erledigt', 'v1', 'v3'), fc.constantFrom('#112233', '#aabbcc')).map(
        ([v, c]) =>
          (d: Doc) =>
            setValueIcon(d, 'baum', v, { color: c, icon: { key: 'flag' } }, 'de'),
      ),
      fc.constantFrom('erfasst', 'v1').map((v) => (d: Doc) => clearValueIcon(d, 'baum', v, 'de')),
      fc.constant((d: Doc) => clearMarker(d, 'baum', 'de')),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 8 }), (steps) => {
        let d = baum();
        for (const step of steps) {
          const r = step(d);
          if (r.ok) d = r.doc;
        }
        expect(
          d.problems().filter((p) => p.code.startsWith('classify_') || p.code.startsWith('marker_')),
        ).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });
});
