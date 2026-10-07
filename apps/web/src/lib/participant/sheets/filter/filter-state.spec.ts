import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Key } from '@ueberblick/core/model';
import {
  emptyFilter,
  isVisible,
  memoryPrefs,
  setTypeVisible,
  setValueVisible,
  typeSwitchOn,
  valueSwitchOn,
} from './filter-state';

const baum = 'baum' as Key;
const flaeche = 'flaeche' as Key;

describe('filter state', () => {
  it('shows everything at first', () => {
    expect(isVisible(emptyFilter, baum, 'erfasst')).toBe(true);
    expect(typeSwitchOn(emptyFilter, baum)).toBe(true);
  });

  it('hiding a type hides all its features and no other type', () => {
    const s = setTypeVisible(emptyFilter, baum, false);
    expect(isVisible(s, baum, 'erfasst')).toBe(false);
    expect(isVisible(s, baum, undefined)).toBe(false);
    expect(isVisible(s, flaeche, undefined)).toBe(true);
  });

  it('hiding one stage hides only that stage of that type', () => {
    const s = setValueVisible(emptyFilter, baum, 'erledigt', false);
    expect(isVisible(s, baum, 'erledigt')).toBe(false);
    expect(isVisible(s, baum, 'erfasst')).toBe(true);
    expect(isVisible(s, flaeche, 'erledigt')).toBe(true);
  });

  it('turning the type switch on again shows every stage again (v3 master switch)', () => {
    let s = setValueVisible(emptyFilter, baum, 'erledigt', false);
    s = setTypeVisible(s, baum, false);
    s = setTypeVisible(s, baum, true);
    expect(isVisible(s, baum, 'erledigt')).toBe(true);
  });

  it('is immutable: the old state is untouched', () => {
    setTypeVisible(emptyFilter, baum, false);
    expect(isVisible(emptyFilter, baum, 'x')).toBe(true);
  });

  it('property: a feature is visible exactly when neither its type nor its stage is hidden (a stage on shows its type)', () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('type' as const), t: fc.constantFrom(baum, flaeche), on: fc.boolean() }),
      fc.record({
        k: fc.constant('value' as const),
        t: fc.constantFrom(baum, flaeche),
        v: fc.constantFrom('a', 'b', 'c'),
        on: fc.boolean(),
      }),
    );
    fc.assert(
      fc.property(
        fc.array(op, { maxLength: 20 }),
        fc.constantFrom(baum, flaeche),
        fc.constantFrom('a', 'b', 'c'),
        (ops, t, v) => {
          let s = emptyFilter;
          let typeOn = true;
          let valueOn = true;
          for (const o of ops) {
            if (o.k === 'type') {
              s = setTypeVisible(s, o.t, o.on);
              if (o.t === t) {
                typeOn = o.on;
                if (o.on) valueOn = true;
              }
            } else {
              s = setValueVisible(s, o.t, o.v, o.on);
              if (o.t === t && o.v === v) valueOn = o.on;
              if (o.t === t && o.on) typeOn = true; // v3: a stage on shows its type
            }
          }
          expect(isVisible(s, t, v)).toBe(typeOn && valueOn);
        },
      ),
    );
  });
});

describe('filter state follows v3 master and stage switches', () => {
  const stages = ['a', 'b'];
  it('the master off switches every stage off; on shows them all', () => {
    const off = setTypeVisible(emptyFilter, baum, false, stages);
    expect(valueSwitchOn(off, baum, 'a')).toBe(false);
    expect(valueSwitchOn(off, baum, 'b')).toBe(false);
    const on = setTypeVisible(off, baum, true, stages);
    expect(valueSwitchOn(on, baum, 'a')).toBe(true);
    expect(typeSwitchOn(on, baum)).toBe(true);
  });
  it('a stage on while the master is off shows the type with only that stage', () => {
    const s = setValueVisible(setTypeVisible(emptyFilter, baum, false, stages), baum, 'a', true, stages);
    expect(isVisible(s, baum, 'a')).toBe(true);
    expect(isVisible(s, baum, 'b')).toBe(false);
  });
  it('the last stage off hides the type', () => {
    let s = setValueVisible(emptyFilter, baum, 'a', false, stages);
    expect(typeSwitchOn(s, baum)).toBe(true);
    s = setValueVisible(s, baum, 'b', false, stages);
    expect(typeSwitchOn(s, baum)).toBe(false);
  });
});

describe('filter prefs seam', () => {
  it('the in-memory prefs return what was saved, as a copy', () => {
    const prefs = memoryPrefs();
    expect(prefs.load()).toBeNull();
    const s = setValueVisible(setTypeVisible(emptyFilter, flaeche, false), baum, 'erledigt', false);
    prefs.save(s);
    const back = prefs.load();
    if (back === null) throw new Error('saved prefs load');
    expect(back).not.toBe(s);
    expect(isVisible(back, flaeche, undefined)).toBe(false);
    expect(isVisible(back, baum, 'erledigt')).toBe(false);
    expect(isVisible(back, baum, 'erfasst')).toBe(true);
  });
});
