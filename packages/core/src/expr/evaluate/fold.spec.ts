/**
 * WP-670: constant timestamp and duration operands are folded once. Folding must change no result and no
 * error. The reference is the same expression with every constant hidden behind `(p ? c : c)` (a variable
 * condition is never constant, so that form is evaluated per call, as before the fold).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ENV, NOW, evalContext } from '../__fixtures__/eval-cases';
import { check, type Env, type TypedAst } from '../check';
import type { EvalContext, EvalResult, EvalValue } from '../contract';
import { parseInstant } from '../functions/support';
import { parse } from '../parse';
import { evaluate } from '.';

const FOLD_ENV: Env = { ...ENV, vars: { ...ENV.vars, p: { kind: 'bool' } } };

function typed(src: string): TypedAst {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse ${src}`);
  const c = check(p.ast, FOLD_ENV);
  if (!c.ok) throw new Error(`check ${src}: ${c.errors.map((e) => e.message).join('; ')}`);
  return c.typed;
}

const ctxAt = (now: string): EvalContext => ({
  ...evalContext(),
  now,
  vars: new Map<string, EvalValue>([...evalContext().vars, ['p', true]]),
});

const hide = (c: string): string => `(p ? ${c} : ${c})`;
const message = (r: EvalResult): EvalValue | string => (r.ok ? r.value : `error: ${r.error.message}`);

const stamp = fc.constantFrom(
  "date('2026-01-01')",
  "date('2026-01-31T10:00:00Z')",
  "date('2026-02-30')",
  "date('nope')",
  "date('2026-03-01T00:00:00+02:00')",
  'now',
  'today()',
);
const duration = fc.constantFrom(
  'days(7)',
  'days(0)',
  'days(-3)',
  'months(1)',
  'months(-13)',
  'days(1) + days(2)',
  'days(2) - months(1)',
  '-days(4)',
);
const tsConst: fc.Arbitrary<string> = fc.oneof(
  stamp,
  fc.tuple(stamp, fc.constantFrom('+', '-'), duration).map(([s, o, d]) => `(${s} ${o} ${d})`),
  fc.tuple(duration, fc.constant('+'), stamp).map(([d, o, s]) => `(${d} ${o} ${s})`),
);
const cmp = fc.constantFrom('<', '<=', '>', '>=', '==', '!=');

const template = fc.oneof(
  fc.tuple(tsConst, cmp, tsConst).map(
    ([a, o, b]) =>
      (h: (c: string) => string) =>
        `${h(a)} ${o} ${h(b)}`,
  ),
  fc.tuple(cmp, tsConst).map(
    ([o, c]) =>
      (h: (c: string) => string) =>
        `self.pruefung ${o} ${h(c)}`,
  ),
  fc.tuple(cmp, tsConst).map(
    ([o, c]) =>
      (h: (c: string) => string) =>
        `${h(c)} ${o} self.pruefung`,
  ),
  fc.tuple(duration, cmp, duration).map(
    ([a, o, b]) =>
      (h: (c: string) => string) =>
        `${h(a)} ${o} ${h(b)}`,
  ),
  fc.tuple(tsConst, tsConst).map(
    ([a, b]) =>
      (h: (c: string) => string) =>
        `days_between(${h(a)}, ${h(b)}) > 3`,
  ),
  fc.tuple(tsConst, cmp, duration).map(
    ([a, o, d]) =>
      (h: (c: string) => string) =>
        `self.pruefung ${o} ${h(a)} && self.pruefung + ${h(d)} > now`,
  ),
);

const NOWS = [NOW, '2024-02-29T23:59:59.999Z', '2026-12-31T00:00:00.000Z'];

describe('folded constants equal the unfolded evaluation', () => {
  it('on generated timestamp and duration expressions, including invalid dates, at several `now`', () => {
    fc.assert(
      fc.property(template, (t) => {
        const folded = typed(t((c) => c));
        const reference = typed(t(hide));
        for (const now of NOWS) {
          const ctx = ctxAt(now);
          // twice: the second evaluation reads the folded value (or fails again), never a stale one
          for (let i = 0; i < 2; i++)
            expect(message(evaluate(folded, ctx))).toEqual(message(evaluate(reference, ctx)));
        }
      }),
      { numRuns: 1500 },
    );
  });

  it('an invalid date literal fails on every evaluation, with the span of its call', () => {
    const t = typed("self.pruefung < date('2026-02-30')");
    const first = evaluate(t, ctxAt(NOW));
    expect(first.ok).toBe(false);
    for (let i = 0; i < 3; i++) expect(evaluate(t, ctxAt(NOW))).toEqual(first);
    if (!first.ok) {
      expect(first.error.message).toBe('not a valid date');
      expect(first.error.span).toEqual({ start: 16, end: 34 });
    }
  });

  it('a `now` based constant follows `ctx.now` of each pass', () => {
    const t = typed('self.pruefung < now - days(7)');
    // pruefung of b1 is 2026-01-01
    expect(evaluate(t, ctxAt('2026-01-10T00:00:00Z'))).toEqual({ ok: true, value: true });
    expect(evaluate(t, ctxAt('2026-01-10T00:00:00Z'))).toEqual({ ok: true, value: true });
    expect(evaluate(t, ctxAt('2026-01-05T00:00:00Z'))).toEqual({ ok: true, value: false });
    expect(evaluate(t, ctxAt('2026-01-10T00:00:00Z'))).toEqual({ ok: true, value: true });
  });

  it('reads `now` only through the context, and not at all when the expression has no `now`', () => {
    let reads = 0;
    const ctx: EvalContext = {
      ...ctxAt(NOW),
      get now() {
        reads++;
        return NOW;
      },
    };
    evaluate(typed("self.pruefung < date('2026-06-01')"), ctx);
    expect(reads).toBe(0);
    const t = typed('self.pruefung < now - days(7)');
    evaluate(t, ctx);
    const first = reads;
    expect(first).toBeGreaterThan(0);
    // once the constant is known, a pass reads `now` once (to see it is unchanged), never again per operand
    evaluate(t, ctx);
    expect(reads - first).toBe(1);
  });
});

describe('parseInstant keeps its strict reading', () => {
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
  /** The reading before WP-670: regex captures and a calendar check for every day. */
  function reference(s: string): number | undefined {
    const m = DATE_RE.exec(s);
    if (!m) return undefined;
    const d = Number(m[3]);
    if (new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, d)).getUTCDate() !== d) return undefined;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? undefined : ms;
  }
  const two = (lo: number, hi: number) =>
    fc.integer({ min: lo, max: hi }).map((n) => String(n).padStart(2, '0'));
  const date = fc
    .tuple(
      fc.integer({ min: 0, max: 2200 }).map((n) => String(n).padStart(4, '0')),
      two(0, 13),
      two(0, 33),
    )
    .map(([y, m, d]) => `${y}-${m}-${d}`);
  it('agrees with the reference on dates, date-times and noise', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          date,
          date.map((d) => `${d}T10:20:30.5Z`),
          date.map((d) => `${d}T10:20+02:00`),
          fc.string(),
        ),
        (s) => parseInstant(s) === reference(s),
      ),
      { numRuns: 5000 },
    );
  });
});
