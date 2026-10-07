import { describe, expect, it } from 'vitest';
import { LOOK_KEY, lookKeyOf, lookKeyOfProperties, markerLooks, resolveMarker, viewLooks } from './index';

const baum = {
  classify: { property: 'zustand', values: { gut: { color: '#16a34a', icon: { key: 'leaf' } } } },
  marker: { color: '#336699' },
};
const mangel = { classify: { property: 'zustand', values: { offen: { color: '#dc2626' } } } };
const plain = {};

describe('the looks of every drawn Objektart (WP-744)', () => {
  const looks = viewLooks({ baum, mangel, plain }, ['baum', 'mangel', 'plain']);

  it('has a look per type and per listed value, picked by the look key', () => {
    expect(looks?.property).toBe(LOOK_KEY);
    expect(Object.keys(looks?.values ?? {}).sort()).toEqual(['baum', 'baum|gut', 'mangel', 'mangel|offen']);
  });

  it('is the look the filter sheet resolves, for each type', () => {
    expect(looks?.values['baum|gut']).toEqual(resolveMarker(baum, 'gut'));
    expect(looks?.values['baum']).toEqual(markerLooks(baum)?.fallback);
    expect(looks?.values['mangel|offen']).toEqual(resolveMarker(mangel, 'offen'));
  });

  it('keeps two types with the same classifying property apart', () => {
    expect(lookKeyOfProperties('baum', baum, { zustand: 'gut' })).toBe('baum|gut');
    expect(lookKeyOfProperties('mangel', mangel, { zustand: 'gut' })).toBe('mangel');
  });

  it('gives a type without a look no key, so it is drawn with the fallback dot', () => {
    expect(lookKeyOf('plain', plain, 'x')).toBeUndefined();
    expect(viewLooks({ plain }, ['plain'])).toBeUndefined();
  });

  it('only holds the types that are drawn', () => {
    expect(Object.keys(viewLooks({ baum, mangel }, ['mangel'])?.values ?? {})).toEqual([
      'mangel',
      'mangel|offen',
    ]);
  });
});
