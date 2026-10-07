import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { COMPILED_FORMAT, CompiledConfigError, compile as compileWith, hydrate, serialize } from './index';
import { TemplateFileSchema } from '../file';
import type { Ty } from '../../expr/check/types';
import { goldenAssets } from '../../testing/golden';
/** Compiles with the golden bundle, so `$ref` layer styles resolve (WP-577). */
const compile = (f: Parameters<typeof compileWith>[0]) => compileWith(f, { assets: goldenAssets });

const base = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const sources = import.meta.glob(['./hydrate.ts', './indexes.ts', './views.ts', './kp.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const compiled = () => {
  const r = compile(TemplateFileSchema.parse(parse(Object.values(base)[0] as string)));
  if (!r.ok) throw new Error('base must compile');
  return r.config;
};

describe('serialize and hydrate', () => {
  it('serialize is plain JSON with the current format', () => {
    const data = serialize(compiled());
    expect(data.format).toBe(COMPILED_FORMAT);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(data.expressions.length).toBeGreaterThan(5);
    expect(Object.keys(data.expressions[0] ?? {}).sort()).toEqual(['ast', 'path', 'source', 'types']);
  });

  it('round trip: hydrate(serialize(c)) has the same file, hash, expressions and lookups', () => {
    const c = compiled();
    const h = hydrate(JSON.parse(JSON.stringify(serialize(c))));
    expect(h.file).toEqual(c.file);
    expect(h.hash).toBe(c.hash);
    expect(h.tasksByType).toEqual(c.tasksByType);
    expect(h.autosByTrigger).toEqual(c.autosByTrigger);
    expect(h.autos).toEqual(c.autos);
    expect([...h.expressions.keys()]).toEqual([...c.expressions.keys()]);
    for (const [path, e] of c.expressions) {
      const g = h.expressions.get(path);
      expect(g?.source).toBe(e.source);
      expect(g?.typed.ast).toEqual(e.typed.ast);
      expect(g?.typed.type).toEqual(e.typed.type);
      // The stored list is pre-order; the checker's map is in inference order. Same nodes, same types.
      const key = (n: unknown): string => JSON.stringify((n as { span: unknown }).span);
      const byNode = (t: typeof e.typed) => new Map([...t.types].map(([n, ty]) => [key(n), ty]));
      const dyn = { kind: 'dyn' };
      const orig = byNode(e.typed);
      for (const [k, ty] of byNode(g?.typed ?? e.typed)) expect(ty).toEqual(orig.get(k) ?? dyn);
    }
  });

  it('serializing a hydrated config gives the same data again', () => {
    const data = serialize(compiled());
    expect(serialize(hydrate(data))).toEqual(data);
  });

  it('refuses data of another format, so the caller recompiles', () => {
    const bad = { ...serialize(compiled()), format: COMPILED_FORMAT + 1 };
    expect(() => hydrate(bad)).toThrow(CompiledConfigError);
    expect(() => hydrate(bad)).toThrow(/format/);
  });

  it('stores one type per AST node, in pre-order', () => {
    const count = (n: unknown): number => {
      const o = n as Record<string, unknown>;
      let c = 1;
      for (const v of Object.values(o)) {
        if (Array.isArray(v)) for (const x of v) c += isNode(x) ? count(x) : 0;
        else if (isNode(v)) c += count(v);
      }
      return c;
    };
    const isNode = (v: unknown): boolean => typeof v === 'object' && v !== null && 'kind' in v && 'span' in v;
    const data = serialize(compiled());
    for (const e of data.expressions) expect(e.types.length, e.path).toBe(count(e.ast));
  });

  it('throws a typed error when `types` does not match the AST (no dyn fallback)', () => {
    const data = serialize(compiled());
    const [first, ...rest] = data.expressions;
    if (!first) throw new Error('expected expressions');
    const short = { ...data, expressions: [{ ...first, types: first.types.slice(1) }, ...rest] };
    const long = {
      ...data,
      expressions: [{ ...first, types: [...first.types, first.types[0] as Ty] }, ...rest],
    };
    for (const bad of [short, long]) {
      try {
        hydrate(bad);
        expect.unreachable('hydrate must throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CompiledConfigError);
        expect((e as CompiledConfigError).code).toBe('types_mismatch');
        expect((e as Error).message).toContain(first.path);
      }
    }
  });

  it('the hydrate path imports neither Zod, the checker, the parser nor the schema (A-005)', () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(4);
    for (const [file, src] of entries) {
      const imports = [...(src as string).matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gms)];
      for (const m of imports) {
        const isType = m[1] !== undefined;
        const from = m[2] as string;
        if (isType) continue;
        expect(from, `${file}: value import ${from}`).not.toMatch(
          /zod|expr\/check|expr\/parse\/(parser|lexer|index)|\.\/exprs|\.\/env/,
        );
        expect(from, `${file}: value import ${from}`).toMatch(
          /^\.\/(contract|indexes|views|kp|autos)$|^\.\.\/\.\.\/registry$|^\.\.\/\.\.\/expr\/parse\/walk$|^\.\.\/\.\.\/template\/paths$/,
        );
      }
    }
  });
});
