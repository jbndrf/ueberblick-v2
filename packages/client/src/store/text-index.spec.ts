/** searchText on the in-memory mirror agrees with a brute-force filter across puts, updates, deletes, diacritics and case. */
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MemoryIndex } from './memory';
import { normalizeText, tokenize } from './text-index';
import type { TextSource } from './contract';
import { isServed } from '@ueberblick/core/registry';

const id = (n: number) => `f${n}` as FeatureId;
const tk = (t: string) => t as Key;
const feat = (n: number, type: string, props: Record<string, string>): FeatureState => ({
  id: id(n),
  type: tk(type),
  properties: props,
  lifecycle: 'active',
  updatedSeq: 1,
});
const src = (type: string, property: string): TextSource => ({ type: tk(type), property });

/** The definition of a match: every query word starts some word of the source values of the feature. */
function brute(feats: Iterable<FeatureState>, sources: readonly TextSource[], q: string): string[] {
  const words = tokenize(q);
  if (words.length === 0) return [];
  const out: string[] = [];
  for (const f of feats) {
    if (!isServed(f.lifecycle)) continue;
    const toks = sources
      .filter((s) => s.type === f.type)
      .flatMap((s) => {
        const v = f.properties[s.property];
        return typeof v === 'string' || typeof v === 'number' ? tokenize(String(v)) : [];
      });
    if (words.every((w) => toks.some((t) => t.startsWith(w)))) out.push(f.id);
  }
  return out.sort();
}

describe('normalizeText', () => {
  it('folds case and diacritics', () => {
    expect(normalizeText('ÄpfEl Über Çà')).toBe('apfel uber ca');
    expect(tokenize('Eiche, Rot-Buche 12')).toEqual(['eiche', 'rot', 'buche', '12']);
  });
});

describe('searchText (client mirror)', () => {
  it('matches prefixes, ignoring case and diacritics', () => {
    const m = new MemoryIndex();
    m.indexText(tk('tree'), 'species');
    m.putFeature(feat(1, 'tree', { species: 'Bergahorn' }));
    m.putFeature(feat(2, 'tree', { species: 'Übelbaum' }));
    m.putFeature(feat(3, 'tree', { species: 'Eiche' }));
    const s = [src('tree', 'species')];
    expect(m.searchText(s, 'BERG', 10)).toEqual([id(1)]);
    expect(m.searchText(s, 'ub', 10)).toEqual([id(2)]);
    expect(m.searchText(s, 'übe', 10)).toEqual([id(2)]);
    expect(m.searchText(s, '', 10)).toEqual([]);
    expect(m.searchText(s, 'x', 10)).toEqual([]);
  });

  it('throws a typed error for a source that was never indexed', () => {
    const m = new MemoryIndex();
    m.putFeature(feat(1, 'tree', { name: 'a' }));
    expect(() => m.searchText([src('tree', 'name')], 'a', 5)).toThrowError(
      expect.objectContaining({ code: 'text_source_not_indexed' }),
    );
  });

  it('honours the limit and unions sources', () => {
    const m = new MemoryIndex();
    m.indexText(tk('tree'), 'name');
    m.indexText(tk('plot'), 'title');
    for (let i = 0; i < 20; i++) m.putFeature(feat(i, 'tree', { name: `ab${i}` }));
    m.putFeature(feat(100, 'plot', { title: 'abc' }));
    expect(m.searchText([src('tree', 'name')], 'ab', 5)).toHaveLength(5);
    expect(m.searchText([src('tree', 'name'), src('plot', 'title')], 'abc', 5)).toEqual([id(100)]);
  });

  it('drops deleted features and re-indexes updates', () => {
    const m = new MemoryIndex();
    const s = [src('tree', 'name')];
    m.indexText(tk('tree'), 'name');
    m.putFeature(feat(1, 'tree', { name: 'alt' }));
    expect(m.searchText(s, 'alt', 5)).toEqual([id(1)]);
    m.putFeature(feat(1, 'tree', { name: 'neu' }));
    expect(m.searchText(s, 'alt', 5)).toEqual([]);
    expect(m.searchText(s, 'neu', 5)).toEqual([id(1)]);
    m.putFeature({ ...feat(1, 'tree', { name: 'neu' }), lifecycle: 'deleted' as const });
    expect(m.searchText(s, 'neu', 5)).toEqual([]);
    m.putFeature(feat(2, 'tree', { name: 'neu' }));
    m.deleteFeature(id(2));
    expect(m.searchText(s, 'neu', 5)).toEqual([]);
  });

  it('indexes features present before registration, and survives clearCache', () => {
    const m = new MemoryIndex();
    m.putFeature(feat(1, 'tree', { name: 'eiche' }));
    m.indexText(tk('tree'), 'name');
    expect(m.searchText([src('tree', 'name')], 'ei', 5)).toEqual([id(1)]);
    m.clearCache();
    expect(m.searchText([src('tree', 'name')], 'ei', 5)).toEqual([]);
    m.putFeature(feat(2, 'tree', { name: 'eibe' }));
    expect(m.searchText([src('tree', 'name')], 'ei', 5)).toEqual([id(2)]);
  });

  it('finds features created by a queued run (prediction overlay)', () => {
    const m = new MemoryIndex();
    const s = [src('tree', 'name')];
    m.putFeature(feat(1, 'tree', { name: 'linde' }));
    m.indexText(tk('tree'), 'name');
    m.setPrediction({
      runId: 'r1',
      features: [feat(1, 'tree', { name: 'buche' }), feat(9, 'tree', { name: 'lindenhof' })],
      edges: [],
    } as never);
    expect(m.searchText(s, 'lind', 5)).toEqual([id(9)]);
    expect(m.searchText(s, 'buc', 5)).toEqual([id(1)]);
    m.removePrediction('r1');
    expect(m.searchText(s, 'lind', 5)).toEqual([id(1)]);
  });

  it('agrees with a brute-force filter over random operations', () => {
    const word = fc.constantFrom(
      'eiche',
      'Eiche',
      'Ähre',
      'ahorn',
      'Bü',
      'buche',
      'birke',
      'ölbaum',
      'x1',
      'x12',
    );
    const value = fc.array(word, { minLength: 1, maxLength: 3 }).map((w) => w.join(' '));
    const op = fc.oneof(
      fc.record({
        k: fc.constant('put' as const),
        n: fc.nat(15),
        type: fc.constantFrom('tree', 'plot'),
        v: value,
      }),
      fc.record({ k: fc.constant('del' as const), n: fc.nat(15) }),
      fc.record({ k: fc.constant('tomb' as const), n: fc.nat(15) }),
    );
    fc.assert(
      fc.property(
        fc.array(op, { maxLength: 60 }),
        fc.constantFrom(
          'e',
          'E',
          'ei',
          'a',
          'ä',
          'ah',
          'b',
          'bu',
          'bü',
          'o',
          'ö',
          'x',
          'x1',
          'eiche ahorn',
          'zz',
        ),
        (ops, q) => {
          const m = new MemoryIndex();
          const sources = [src('tree', 'name'), src('plot', 'name')];
          m.indexText(tk('tree'), 'name');
          m.indexText(tk('plot'), 'name');
          const model = new Map<string, FeatureState>();
          for (const o of ops) {
            if (o.k === 'put') {
              const f = feat(o.n, o.type, { name: o.v });
              m.putFeature(f);
              model.set(f.id, f);
            } else if (o.k === 'del') {
              m.deleteFeature(id(o.n));
              model.delete(id(o.n));
            } else {
              const prev = model.get(id(o.n));
              if (prev) {
                const t = { ...prev, lifecycle: 'deleted' as const };
                m.putFeature(t);
                model.set(t.id, t);
              }
            }
          }
          expect([...m.searchText(sources, q, 1000)].sort()).toEqual(brute(model.values(), sources, q));
        },
      ),
      { numRuns: 300 },
    );
  });
});
