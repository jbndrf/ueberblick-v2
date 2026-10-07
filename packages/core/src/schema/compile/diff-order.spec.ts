import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from 'yaml';
import { compile, diff } from './index';
import { breakingChanges, merge } from '../../template';
import { TemplateFileSchema, type OverlayFile, type TemplateFile } from '../file';
import { NO_ASSETS } from './assets';

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const base = (): TemplateFile => TemplateFileSchema.parse(parse(Object.values(raw)[0] as string));

type Plain = Record<string, unknown>;
const reorder = (m: Plain, keys: readonly string[]): Plain => Object.fromEntries(keys.map((k) => [k, m[k]]));
const permutation = (n: number): fc.Arbitrary<number[]> =>
  fc.shuffledSubarray(
    Array.from({ length: n }, (_, i) => i),
    { minLength: n, maxLength: n },
  );

const at = (root: unknown, path: readonly string[]): Plain =>
  path.reduce<unknown>((n, p) => (n as Plain)[p], root) as Plain;

/** A copy of the base file with the map at `path` rewritten by `f`. */
function withMap(path: readonly string[], f: (m: Plain) => Plain): TemplateFile {
  const file = structuredClone(base()) as unknown as Plain;
  const parent = at(file, path.slice(0, -1));
  const last = path[path.length - 1] as string;
  parent[last] = f(parent[last] as Plain);
  return file as unknown as TemplateFile;
}

const SITES: readonly { name: string; path: readonly string[] }[] = [
  { name: 'property order', path: ['types', 'baum', 'properties'] },
  { name: 'task order', path: ['tasks'] },
];

describe('diff: order is a change (A-042)', () => {
  for (const site of SITES) {
    it(`${site.name}: exactly one non-breaking order_changed entry, none for the same order`, () => {
      const keys = Object.keys(at(base(), site.path));
      expect(keys.length).toBeGreaterThan(1);
      fc.assert(
        fc.property(permutation(keys.length), (perm) => {
          const order = perm.map((i) => keys[i] as string);
          const b = withMap(site.path, (m) => reorder(m, order));
          const d = diff(base(), b);
          if (order.every((k, i) => k === keys[i])) expect(d).toEqual([]);
          else {
            expect(d).toHaveLength(1);
            expect(d[0]).toMatchObject({
              path: site.path.join('.'),
              change: 'order_changed',
              breaking: false,
              before: keys,
              after: order,
            });
          }
          expect(breakingChanges(base(), b)).toEqual(breakingChanges(base(), base()));
        }),
        { numRuns: 50 },
      );
    });
  }

  it('form entry order is one order_changed entry at the form', () => {
    const a = base();
    const key = Object.keys(a.tasks ?? {}).find((k) => Object.keys(a.tasks?.[k]?.form ?? {}).length > 1);
    expect(key).toBeDefined();
    const b = withMap(['tasks', key as string, 'form'], (m) => reorder(m, Object.keys(m).reverse()));
    expect(diff(a, b)).toMatchObject([
      { path: `tasks.${key}.form`, change: 'order_changed', breaking: false },
    ]);
  });

  it('overlay `order` alone gives one order_changed entry in the effective file', () => {
    const t = base();
    const overlay = {
      schema: t.schema,
      template: { key: t.template.key, version: t.template.version },
      order: { 'types.baum.properties': Object.keys(t.types?.baum?.properties ?? {}).reverse() },
    } as unknown as OverlayFile;
    const r = merge(t, overlay);
    expect(r.issues).toEqual([]);
    expect(diff(t, r.file)).toMatchObject([
      { path: 'types.baum.properties', change: 'order_changed', breaking: false },
    ]);
  });

  it('adding a key in the middle is not an order change', () => {
    const b = withMap(['types', 'baum', 'properties'], (m) => {
      const [first, ...rest] = Object.entries(m);
      return Object.fromEntries([first, ['mitte', { type: 'text' }], ...rest] as [string, unknown][]);
    });
    expect(diff(base(), b).map((e) => e.change)).toEqual(['added']);
  });
});

describe('hash: order is identity (A-042)', () => {
  const hashOf = (f: TemplateFile): string => {
    const r = compile(f, { assets: NO_ASSETS });
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    return r.config.hash;
  };
  it('differs for another order, equals for equal content in equal order', () => {
    const a = base();
    const keys = Object.keys(a.types?.baum?.properties ?? {});
    const b = withMap(['types', 'baum', 'properties'], (m) => reorder(m, [...keys].reverse()));
    expect(hashOf(a)).toBe(hashOf(structuredClone(a)));
    expect(hashOf(a)).not.toBe(hashOf(b));
    expect(hashOf(b)).toBe(hashOf(structuredClone(b)));
  });
});
