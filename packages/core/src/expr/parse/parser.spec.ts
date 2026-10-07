import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARSE_LIMITS, type Expr } from '../ast';
import { PARSE_ERR, PARSE_OK } from '../__fixtures__/parse-cases';
import { toSexpr } from '../__fixtures__/sexpr';
import { children, deepest, parse } from '.';

function ok(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`${src}: ${r.errors[0]?.message ?? '?'}`);
  return r.ast;
}

describe('parse: corpus of valid expressions', () => {
  it.each(PARSE_OK)('%s', (src, sexpr) => {
    expect(toSexpr(ok(src))).toBe(sexpr);
  });
});

describe('parse: corpus of rejected expressions', () => {
  it.each(PARSE_ERR)('%j -> %s', (src, fragment, start, end) => {
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const [err] = r.errors;
    expect(err?.message).toContain(fragment);
    expect(err?.span.start).toBe(start);
    // the end-of-input error is zero-width at the end; every other span has a width
    expect(err?.span.end).toBeGreaterThanOrEqual(err?.span.start ?? 0);
    expect(err?.span.end).toBe(start === src.length ? start : end);
  });
});

describe('parse: spans', () => {
  it('cover the exact source text of every node', () => {
    const src = "self.items.filter(i, i.n > 1) && (a in ['x', 'y']) ? -1 : has(self.z)";
    const walk = (e: Expr): void => {
      expect(e.span.start).toBeLessThan(e.span.end);
      expect(e.span.end).toBeLessThanOrEqual(src.length);
      for (const c of children(e)) {
        expect(c.span.start).toBeGreaterThanOrEqual(e.span.start);
        expect(c.span.end).toBeLessThanOrEqual(e.span.end);
        walk(c);
      }
    };
    const ast = ok(src);
    walk(ast);
    expect(ast.span).toEqual({ start: 0, end: src.length });
  });

  it('point at the operator operands and members', () => {
    const src = 'self.stage == "x"';
    const ast = ok(src);
    expect(ast.kind).toBe('binary');
    if (ast.kind !== 'binary') return;
    expect(src.slice(ast.left.span.start, ast.left.span.end)).toBe('self.stage');
    expect(src.slice(ast.right.span.start, ast.right.span.end)).toBe('"x"');
  });

  it('include the parentheses of a parenthesised expression', () => {
    const ast = ok('(a + b) * c');
    expect(ast.kind === 'binary' && ast.left.span).toEqual({ start: 0, end: 7 });
  });
});

describe('parse: limits for untrusted input (H4)', () => {
  it('rejects source longer than maxLength', () => {
    const r = parse('1'.repeat(PARSE_LIMITS.config.maxLength + 1));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]?.message).toContain('longer than');
  });

  it('accepts source exactly at maxLength', () => {
    expect(parse('1'.repeat(PARSE_LIMITS.config.maxLength)).ok).toBe(false); // out of range number, not length
    expect(parse(' '.repeat(PARSE_LIMITS.config.maxLength - 1) + '1').ok).toBe(true);
  });

  it('rejects deeply nested parentheses without a stack overflow', () => {
    const r = parse('('.repeat(3000) + '1' + ')'.repeat(3000), { maxLength: 10_000, maxDepth: 64 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]?.message).toContain('nested deeper');
  });

  it('rejects deeply nested unary and list nesting', () => {
    expect(parse('!'.repeat(200) + 'a').ok).toBe(false);
    expect(parse('['.repeat(200) + ']'.repeat(200)).ok).toBe(false);
  });

  it('parses a 1,000-term || chain and a 1,000-term + chain under config limits', () => {
    for (const op of ['||', '+']) {
      const src = Array.from({ length: 1000 }, () => 'a').join(` ${op} `);
      expect(src.length).toBeLessThanOrEqual(PARSE_LIMITS.config.maxLength);
      expect(parse(src, PARSE_LIMITS.config).ok, op).toBe(true);
    }
  });

  it('rejects 3,000 nested parentheses with a span under both limit sets', () => {
    const src = '('.repeat(3000) + '1' + ')'.repeat(3000);
    for (const limits of [PARSE_LIMITS.config, { ...PARSE_LIMITS.config, maxLength: 10_000 }]) {
      const r = parse(src, limits);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.span.end).toBeGreaterThan(r.errors[0]?.span.start ?? 0);
    }
  });

  it('untrusted limits are stricter than config in length and depth', () => {
    const { config, untrusted } = PARSE_LIMITS;
    expect(untrusted.maxLength).toBeLessThan(config.maxLength);
    expect(untrusted.maxDepth).toBeLessThan(config.maxDepth);
    const nest = (n: number): string => '('.repeat(n) + '1' + ')'.repeat(n);
    expect(parse(nest(untrusted.maxDepth), untrusted).ok).toBe(false); // +1 for the outer expression
    expect(parse(nest(untrusted.maxDepth - 1), untrusted).ok).toBe(true);
    expect(parse(nest(untrusted.maxDepth), config).ok).toBe(true);
    const long = 'a || '.repeat(Math.ceil(untrusted.maxLength / 5)) + 'a';
    expect(parse(long, untrusted).ok).toBe(false);
    expect(parse(long, config).ok).toBe(true);
  });

  it('honours custom limits', () => {
    expect(parse('((a))', { maxLength: 100, maxDepth: 2 }).ok).toBe(false);
    expect(parse('((a))', { maxLength: 100, maxDepth: 3 }).ok).toBe(true);
    expect(parse('abc', { maxLength: 2, maxDepth: 10 }).ok).toBe(false);
  });

  it('nesting at the limit is accepted', () => {
    expect(deepest(ok('((((((a))))))')).depth).toBe(1);
    expect(parse('!'.repeat(30) + 'a').ok).toBe(true);
  });
});

/** A generated expression as source text plus its expected s-expression. */
interface Gen {
  readonly src: string;
  readonly sx: string;
}

const ident = fc.constantFrom('a', 'b', 'self', 'form', 'x1');
const leaf: fc.Arbitrary<Gen> = fc.oneof(
  ident.map((n) => ({ src: n, sx: n })),
  fc.nat(1000).map((n) => ({ src: String(n), sx: String(n) })),
  fc.constantFrom(true, false).map((b) => ({ src: String(b), sx: String(b) })),
  fc.constant({ src: 'null', sx: 'null' }),
  fc.constantFrom('', 'a', 'b c', "it's").map((s) => ({ src: JSON.stringify(s), sx: JSON.stringify(s) })),
);

const BIN = ['||', '&&', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', 'in'] as const;

const expr: fc.Arbitrary<Gen> = fc.letrec<{ e: Gen }>((tie) => ({
  e: fc.oneof(
    { depthSize: 'small', maxDepth: 4 },
    leaf,
    fc.tuple(fc.constantFrom(...BIN), tie('e'), tie('e')).map(([op, l, r]) => ({
      src: `(${l.src} ${op} ${r.src})`,
      sx: `(${op} ${l.sx} ${r.sx})`,
    })),
    tie('e').map((o) => ({ src: `!(${o.src})`, sx: `(! ${o.sx})` })),
    tie('e').map((o) => ({ src: `-(${o.src})`, sx: `(- ${o.sx})` })),
    fc.tuple(tie('e'), tie('e'), tie('e')).map(([t, a, b]) => ({
      src: `(${t.src} ? ${a.src} : ${b.src})`,
      sx: `(?: ${t.sx} ${a.sx} ${b.sx})`,
    })),
    fc.tuple(tie('e'), ident).map(([o, f]) => ({ src: `(${o.src}).${f}`, sx: `(. ${o.sx} ${f})` })),
    fc
      .tuple(tie('e'), tie('e'))
      .map(([o, i]) => ({ src: `(${o.src})[${i.src}]`, sx: `([] ${o.sx} ${i.sx})` })),
    fc.array(tie('e'), { maxLength: 3 }).map((xs) => ({
      src: `[${xs.map((x) => x.src).join(', ')}]`,
      sx: `[${xs.map((x) => x.sx).join(' ')}]`,
    })),
    fc.tuple(fc.constantFrom('exists', 'all', 'filter', 'map'), tie('e'), tie('e')).map(([m, r, b]) => ({
      src: `(${r.src}).${m}(v, ${b.src})`,
      sx: `(${m} ${r.sx} v ${b.sx})`,
    })),
  ),
})).e;

describe('parse: properties', () => {
  it('a fully parenthesised generated expression parses to exactly its tree', () => {
    fc.assert(
      fc.property(expr, (g) => {
        const r = parse(g.src);
        expect(r.ok).toBe(true);
        if (r.ok) expect(toSexpr(r.ast)).toBe(g.sx);
      }),
      { numRuns: 300 },
    );
  });

  it('never throws and always yields a well-formed result for arbitrary text', () => {
    const alphabet = fc.stringMatching(/^[a-z0-9 .,()[\]{}'"!&|=<>+*/%?:\\-]{0,60}$/);
    fc.assert(
      fc.property(fc.oneof(alphabet, fc.string()), (s) => {
        const r = parse(s);
        if (r.ok) {
          expect(r.ast.span.end).toBeLessThanOrEqual(s.length);
        } else {
          expect(r.errors.length).toBeGreaterThan(0);
          for (const e of r.errors) {
            expect(e.span.start).toBeGreaterThanOrEqual(0);
            expect(e.span.end).toBeGreaterThanOrEqual(e.span.start);
            expect(e.span.end).toBeLessThanOrEqual(Math.max(s.length, e.span.start + 1));
            expect(e.message.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(expr, (g) => {
        expect(parse(g.src)).toEqual(parse(g.src));
      }),
      { numRuns: 100 },
    );
  });
});
