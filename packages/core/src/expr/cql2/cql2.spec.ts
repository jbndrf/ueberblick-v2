import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CQL2_CASES } from '../__fixtures__/cql2-cases';
import { CQL2_ERRORS, CQL2_JSON_ERRORS } from '../__fixtures__/cql2-error-cases';
import { CQL2_SPATIAL_CASES } from '../__fixtures__/cql2-spatial-cases';
import { toSexpr } from '../__fixtures__/sexpr';
import { PARSE_LIMITS, type Expr, type ParseError } from '../ast';
import { deepest, parse } from '../parse';
import { fromCql2, type Cql2Options } from '.';

function cel(src: string): string {
  const r = parse(src);
  if (!r.ok) throw new Error(`${src}: ${r.errors[0]?.message ?? '?'}`);
  return toSexpr(r.ast);
}

function good(input: string | object): Expr {
  const r = fromCql2(input);
  if (!r.ok) throw new Error(`${JSON.stringify(input)}: ${r.errors[0]?.message ?? '?'}`);
  return r.ast;
}

function errors(input: string | object, options?: Cql2Options): readonly ParseError[] {
  const r = fromCql2(input, options);
  if (r.ok) throw new Error(`expected errors for ${JSON.stringify(input)}`);
  return r.errors;
}

const ALL = [...CQL2_CASES, ...CQL2_SPATIAL_CASES];

describe('fromCql2: corpus (text and JSON)', () => {
  it('has at least 60 cases', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(60);
  });
  it.each(ALL)('$name (text)', (c) => {
    expect(toSexpr(good(c.text))).toBe(cel(c.cel));
  });
  it.each(ALL)('$name (json object)', (c) => {
    expect(toSexpr(good(c.json as object))).toBe(cel(c.cel));
  });
  it.each(ALL)('$name (json text)', (c) => {
    expect(toSexpr(good(JSON.stringify(c.json)))).toBe(cel(c.cel));
  });
});

describe('fromCql2: rejected input carries spans', () => {
  it.each(CQL2_ERRORS)('%j -> %s', (src, fragment, start) => {
    const [err] = errors(src);
    expect(err?.message).toContain(fragment);
    expect(err?.span.start).toBe(start);
    expect(err?.span.end).toBeGreaterThanOrEqual(start);
    expect(err?.span.end).toBeLessThanOrEqual(src.length);
  });
  it.each(CQL2_JSON_ERRORS)('json %j -> %s', (value, fragment) => {
    const [err] = errors(value as object);
    expect(err?.message).toContain(fragment);
  });
  it('json text that is not JSON is an error with a span', () => {
    const [err] = errors('{"op": ');
    expect(err?.message).toContain('JSON');
    expect(err?.span.start).toBeGreaterThanOrEqual(0);
  });
  it('json errors name the location', () => {
    const [err] = errors({ op: 'and', args: [true, { op: 'nope', args: [] }] });
    expect(err?.message).toContain('/args/1');
  });
});

describe('fromCql2: every AST node is one of expr/ast', () => {
  it('spans in text encoding point into the source', () => {
    const src = "floors > 5 AND name LIKE 'Ma%'";
    const ast = good(src);
    expect(ast.span).toEqual({ start: 0, end: src.length });
  });
});

describe('fromCql2: limits (H4)', () => {
  it('rejects text longer than maxLength', () => {
    const src = `a = '${'x'.repeat(PARSE_LIMITS.untrusted.maxLength)}'`;
    expect(errors(src)[0]?.message).toContain('longer than');
  });
  it('rejects deep nesting without overflowing the stack', () => {
    const src = `${'('.repeat(3000)}a = 1${')'.repeat(3000)}`;
    expect(errors(src).length).toBe(1);
    let nested: object = { op: '=', args: [{ property: 'a' }, 1] };
    for (let i = 0; i < 500; i++) nested = { op: 'not', args: [nested] };
    expect(errors(nested)[0]?.message).toContain('nested deeper');
  });
  it('flat OR/AND chains and IN lists do not count as depth (H6)', () => {
    const terms = Array.from({ length: 1000 }, (_, i) => `a = ${String(i)}`);
    expect(good(terms.join(' OR ')).kind).toBe('binary');
    expect(good(terms.join(' AND ')).kind).toBe('binary');
    const json = { op: 'or', args: terms.map((_, i) => ({ op: '=', args: [{ property: 'a' }, i] })) };
    expect(good(json).kind).toBe('binary');
    const small = { op: 'or', args: json.args.slice(0, 300) };
    expect(good(JSON.stringify(small)).kind).toBe('binary');
    expect(good(`a IN (${terms.map((_, i) => String(i)).join(', ')})`).kind).toBe('binary');
    expect(errors(`${'NOT '.repeat(40)}a = 1`)[0]?.message).toContain('nested deeper');
  });
  it('honours custom limits', () => {
    expect(errors('a = 1', { limits: { maxLength: 3, maxDepth: 64 } })[0]?.message).toContain('longer than');
    expect(deepest(good('a = 1')).depth).toBeLessThanOrEqual(PARSE_LIMITS.untrusted.maxDepth);
  });
  it('parses 1000 filters', () => {
    const inputs = ALL.map((c) => c.text);
    for (let i = 0; i < 1000; i++) fromCql2(inputs[i % inputs.length] as string);
  });
  it('never throws on arbitrary strings or JSON', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (s) => {
        fromCql2(s);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        fromCql2(v as object);
      }),
      { numRuns: 500 },
    );
  });
});

// ---- property test: text and JSON encodings agree -----------------------------------------

interface Gen {
  readonly text: string;
  readonly json: unknown;
}

const name = fc.constantFrom('a', 'b', 'floors', 'geometry', 'owner');
const prop: fc.Arbitrary<Gen> = name.map((n) => ({ text: n, json: { property: n } }));
const num: fc.Arbitrary<Gen> = fc.oneof(
  fc.integer({ min: -1000, max: 1000 }).map((n) => ({ text: String(n), json: n })),
  fc
    .integer({ min: -1000, max: 1000 })
    .map((n) => ({ text: `${String(n)}.5`, json: n + (n < 0 ? -0.5 : 0.5) })),
);
const str: fc.Arbitrary<Gen> = fc
  .string({ maxLength: 8, unit: fc.constantFrom('a', 'b', "'", ' ', 'é', '1') })
  .map((s) => ({ text: `'${s.replaceAll("'", "''")}'`, json: s }));
const coord = fc.tuple(fc.integer({ min: -180, max: 180 }), fc.integer({ min: -90, max: 90 }));
const geom: fc.Arbitrary<Gen> = fc.oneof(
  coord.map(([x, y]) => ({
    text: `POINT(${String(x)} ${String(y)})`,
    json: { type: 'Point', coordinates: [x, y] },
  })),
  fc.array(coord, { minLength: 2, maxLength: 4 }).map((cs) => ({
    text: `LINESTRING(${cs.map(([x, y]) => `${String(x)} ${String(y)}`).join(', ')})`,
    json: { type: 'LineString', coordinates: cs },
  })),
  fc.tuple(coord, fc.integer({ min: 0, max: 50 })).map(([[x, y], d]) => {
    const ring = [
      [x, y],
      [x + d + 1, y],
      [x + d + 1, y + d + 1],
      [x, y],
    ];
    return {
      text: `POLYGON((${ring.map(([px, py]) => `${String(px)} ${String(py)}`).join(',')}))`,
      json: { type: 'Polygon', coordinates: [ring] },
    };
  }),
);
const value: fc.Arbitrary<Gen> = fc.oneof(prop, num, str);
const CMP: readonly (readonly [string, string])[] = [
  ['=', '='],
  ['<>', '<>'],
  ['<', '<'],
  ['<=', '<='],
  ['>', '>'],
  ['>=', '>='],
];
const SPATIAL = ['intersects', 'within', 'contains', 'touches', 'disjoint'] as const;

const atom: fc.Arbitrary<Gen> = fc.oneof(
  fc.tuple(value, fc.constantFrom(...CMP), value).map(([l, [t, j], r]) => ({
    text: `${l.text} ${t} ${r.text}`,
    json: { op: j, args: [l.json, r.json] },
  })),
  fc.tuple(prop, fc.boolean()).map(([p, neg]) => ({
    text: `${p.text} IS ${neg ? 'NOT ' : ''}NULL`,
    json: neg ? { op: 'not', args: [{ op: 'isNull', args: [p.json] }] } : { op: 'isNull', args: [p.json] },
  })),
  fc.tuple(prop, fc.array(fc.oneof(num, str), { minLength: 1, maxLength: 4 })).map(([p, xs]) => ({
    text: `${p.text} IN (${xs.map((x) => x.text).join(', ')})`,
    json: { op: 'in', args: [p.json, xs.map((x) => x.json)] },
  })),
  fc.tuple(prop, num, num).map(([p, lo, hi]) => ({
    text: `${p.text} BETWEEN ${lo.text} AND ${hi.text}`,
    json: { op: 'between', args: [p.json, lo.json, hi.json] },
  })),
  fc
    .tuple(prop, fc.constantFrom('ab%', '%ab', '%ab%', 'ab'))
    .map(([p, pat]) => ({ text: `${p.text} LIKE '${pat}'`, json: { op: 'like', args: [p.json, pat] } })),
  fc.tuple(fc.constantFrom(...SPATIAL), prop, geom).map(([f, p, g]) => ({
    text: `S_${f.toUpperCase()}(${p.text}, ${g.text})`,
    json: { op: `s_${f}`, args: [p.json, g.json] },
  })),
);

const filter = fc.letrec<{ f: Gen }>((tie) => ({
  f: fc.oneof(
    { depthSize: 'small', maxDepth: 3 },
    atom,
    fc.tuple(tie('f'), tie('f')).map(([l, r]) => ({
      text: `(${l.text}) AND (${r.text})`,
      json: { op: 'and', args: [l.json, r.json] },
    })),
    fc
      .tuple(tie('f'), tie('f'))
      .map(([l, r]) => ({ text: `(${l.text}) OR (${r.text})`, json: { op: 'or', args: [l.json, r.json] } })),
    tie('f').map((x) => ({ text: `NOT (${x.text})`, json: { op: 'not', args: [x.json] } })),
  ),
})).f;

describe('fromCql2: the encodings agree (property)', () => {
  it('text and JSON of the same filter give equal ASTs', () => {
    fc.assert(
      fc.property(filter, (g) => {
        const t = fromCql2(g.text);
        const j = fromCql2(g.json as object);
        const jt = fromCql2(JSON.stringify(g.json));
        if (!t.ok || !j.ok || !jt.ok) throw new Error(g.text);
        expect(toSexpr(j.ast)).toBe(toSexpr(t.ast));
        expect(toSexpr(jt.ast)).toBe(toSexpr(t.ast));
      }),
      { numRuns: 300 },
    );
  });
});
