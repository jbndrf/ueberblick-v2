/** A property test for the view builder (WP-665): core evaluates a written view the way its rows read. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FeatureState } from '../model';
import type { Clause } from './clauses';
import { filterToClauses } from './clauses-decode';
import { applyFilter, compileFilter } from './index';
import { envOver, featureOf, NOW } from './__fixtures__/views-world';
import {
  by,
  choice,
  config,
  ctx,
  day,
  dayTime,
  encode,
  kontrolle,
  num,
  stage,
  text,
  when,
} from './__fixtures__/views-rows';

// A property test: for random rows and random features, core's evaluation of the written source equals a plain
// reading of what each row means (the oracle). This is "the same way the core evaluates it".
const DAYS = ['2026-09-01', '2026-09-15', '2026-10-01', '2026-10-05', '2026-10-09'] as const;
const stamp = (d: string, h: number): string => `${d}T${String(h).padStart(2, '0')}:00:00.000Z`;

const featureArb = fc
  .record({
    n: fc.integer({ min: 0, max: 9999 }),
    type: fc.constantFrom('baum', 'bank'),
    name: fc.constantFrom('eiche', 'linde', 'alte eiche', ''),
    hoehe: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
    pflanz: fc.option(fc.constantFrom(...DAYS), { nil: undefined }),
    kontrolliert: fc.option(fc.tuple(fc.constantFrom(...DAYS), fc.integer({ min: 0, max: 23 })), {
      nil: undefined,
    }),
    art: fc.option(fc.constantFrom('eiche', 'linde'), { nil: undefined }),
    tags: fc.subarray(['a', 'b']),
    stufe: fc.constantFrom('neu', 'geprueft', 'fertig'),
    by: fc.option(fc.constantFrom('u1', 'u2', 'u3'), { nil: undefined }),
    created: fc.tuple(fc.constantFrom(...DAYS), fc.integer({ min: 0, max: 23 })),
    changed: fc.tuple(fc.constantFrom(...DAYS), fc.integer({ min: 0, max: 23 })),
  })
  .map((r): FeatureState => {
    const p: Record<string, unknown> =
      r.type === 'baum' ? { name: r.name, tags: r.tags, stufe: r.stufe } : { material: r.name };
    if (r.type === 'baum') {
      if (r.hoehe !== undefined) p['hoehe'] = r.hoehe;
      if (r.pflanz !== undefined) p['pflanzdatum'] = r.pflanz;
      if (r.kontrolliert !== undefined) p['kontrolliert'] = stamp(r.kontrolliert[0], r.kontrolliert[1]);
      if (r.art !== undefined) p['art'] = r.art;
    }
    return featureOf(`f${r.n}`, r.type, p as never, {
      ...(r.by !== undefined ? { createdBy: r.by } : {}),
      createdAt: stamp(r.created[0], r.created[1]),
      changedAt: stamp(r.changed[0], r.changed[1]),
    });
  });

const clauseArb: fc.Arbitrary<Clause> = fc.oneof(
  fc.constantFrom('eiche', 'ind', 'x').map(text),
  fc
    .tuple(
      fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
      fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
    )
    .map(([a, b]) => num(a, b)),
  fc
    .tuple(
      fc.option(fc.constantFrom(...DAYS), { nil: null }),
      fc.option(fc.constantFrom(...DAYS), { nil: null }),
    )
    .map(([a, b]) => day(a, b)),
  fc
    .tuple(
      fc.option(fc.constantFrom(...DAYS), { nil: null }),
      fc.option(fc.constantFrom(...DAYS), { nil: null }),
    )
    .map(([a, b]) => dayTime(a, b)),
  fc.subarray(['eiche', 'linde']).map((v) => choice('art', 'select', v)),
  fc.subarray(['a', 'b']).map((v) => choice('tags', 'multiselect', v)),
  fc.subarray(['neu', 'geprueft', 'fertig']).map(stage),
  fc
    .tuple(
      fc.constantFrom('created', 'changed'),
      fc.constantFrom('older', 'newer'),
      fc.integer({ min: 1, max: 40 }),
    )
    .map(([f, m, d]) => when(f as 'created', m as 'older', d)),
  fc
    .tuple(
      fc.constantFrom('created', 'changed'),
      fc.option(fc.constantFrom(...DAYS), { nil: null }),
      fc.option(fc.constantFrom(...DAYS), { nil: null }),
    )
    .map(([f, a, b]) => when(f as 'created', 'between', 7, a, b)),
  fc.subarray(['u1', 'u2', 'u3']).map(by),
);

const DAY_MS = 86_400_000;
/** What one row means, read plainly off a feature (never through the rule language). */
function holds(c: Clause, f: FeatureState): boolean {
  const empty = (): boolean => true;
  const p = f.properties as Record<string, unknown>;
  const dayRange = (
    v: string | undefined,
    from: string | null,
    to: string | null,
    whole: boolean,
  ): boolean => {
    if (from === null && to === null) return empty();
    if (v === undefined) return false;
    if (from !== null && v < from) return false;
    if (to !== null && (whole ? v.slice(0, 10) > to : v > to)) return false;
    return true;
  };
  switch (c.kind) {
    case 'field': {
      if (c.type !== f.type) return true;
      if (c.editor === 'text')
        return (
          c.text.trim() === '' || (typeof p[c.key] === 'string' && (p[c.key] as string).includes(c.text))
        );
      if (c.editor === 'number') {
        if (c.min === null && c.max === null) return true;
        const v = p[c.key];
        return typeof v === 'number' && (c.min === null || v >= c.min) && (c.max === null || v <= c.max);
      }
      if (c.editor === 'date')
        return dayRange(p[c.key] as string | undefined, c.from, c.to, c.propType === 'datetime');
      if (c.editor !== 'choice') return true; // the WP-809 rows are covered by rows.spec
      if (c.values.length === 0) return true;
      const v = p[c.key];
      return Array.isArray(v)
        ? c.values.some((x) => v.includes(x))
        : typeof v === 'string' && c.values.includes(v);
    }
    case 'stage':
      return c.type !== f.type || c.values.length === 0 || c.values.includes(p['stufe'] as string);
    case 'created_by':
      return c.values.length === 0 || (f.createdBy !== undefined && c.values.includes(f.createdBy));
    case 'when': {
      const at = c.field === 'created' ? f.createdAt : f.changedAt;
      if (c.mode === 'between') return dayRange(at, c.from, c.to, true);
      if (at === undefined) return false;
      const age = Date.parse(NOW) - Date.parse(at);
      return c.mode === 'older' ? age > c.days * DAY_MS : age < c.days * DAY_MS;
    }
    case 'rule':
      return true;
  }
}

describe('property: core evaluates a written view as the rows mean', () => {
  it('for random rows and features, applyFilter agrees with the plain reading', () => {
    fc.assert(
      fc.property(
        fc.array(clauseArb, { maxLength: 5 }),
        fc.array(featureArb, { minLength: 1, maxLength: 12 }),
        (rows, features) => {
          const all = features.map((f, i) => ({ ...f, id: `${f.id}-${i}` as never }));
          const filters = encode(rows);
          const r = compileFilter(config, filters);
          if (!r.ok) throw new Error(JSON.stringify(r.problems));
          const env = envOver(config, kontrolle, all);
          const got = new Set<string>();
          for (const t of ['baum', 'bank']) for (const f of applyFilter(env, r.filter, t, all)) got.add(f.id);
          const want = all.filter((f) => rows.every((c) => holds(c, f))).map((f) => f.id);
          expect([...got].sort()).toEqual([...want].sort());
        },
      ),
      { numRuns: 300 },
    );
  });
  it('and decoding what was written gives the rows back (as a set)', () => {
    fc.assert(
      fc.property(fc.array(clauseArb, { maxLength: 6 }), (rows) => {
        // Two ranges on one property fold into one row, so one range per property here.
        const seen = new Set<string>();
        const unique = rows.filter((c) => {
          const slot =
            c.kind === 'field' && (c.editor === 'number' || c.editor === 'date')
              ? c.key
              : c.kind === 'when' && c.mode === 'between'
                ? `w${c.field}`
                : undefined;
          if (slot === undefined) return true;
          if (seen.has(slot)) return false;
          seen.add(slot);
          return true;
        });
        const live = unique;
        const back = filterToClauses(config, encode(unique), ctx.types);
        // two rows on one property fold into one range: compare after encoding again
        const quoted = (f: Record<string, string>) =>
          JSON.stringify(f).replaceAll("'", '\\"').replaceAll('\\\\"', '"');
        expect(quoted(encode(back))).toEqual(quoted(encode(live)));
      }),
      { numRuns: 200 },
    );
  });
});
