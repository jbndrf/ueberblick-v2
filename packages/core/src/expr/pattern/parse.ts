/**
 * The pattern syntax of `matches(text, pattern)` (docs/06 "matches"): a safe subset of regular expressions with
 * RE2 semantics. Parsed to a small tree that `nfa.ts` compiles; no backreferences, no lookaround, no lazy or
 * possessive quantifiers. Pure and total: a bad pattern is a `PatternProblem`, never an exception.
 */
import { MATCHES_LIMITS } from '../../registry/expr-matches';
import type { MatchesSyntaxProblem, MatchesUnsupportedFeature } from '../../registry/expr-matches-problems';
import type { ExprErrorCode } from '../../registry/expr-errors';

export type Range = readonly [number, number];
export interface CharSet {
  readonly ranges: readonly Range[];
  readonly negate: boolean;
}

export type PatternNode =
  | { readonly k: 'set'; readonly set: CharSet }
  | { readonly k: 'cat'; readonly items: readonly PatternNode[] }
  | { readonly k: 'alt'; readonly items: readonly PatternNode[] }
  | { readonly k: 'rep'; readonly node: PatternNode; readonly min: number; readonly max: number | null }
  | { readonly k: 'bol' }
  | { readonly k: 'eol' };

/** A refused pattern: the `EXPR_ERRORS` code and its flat params. */
export interface PatternProblem {
  readonly code: Extract<
    ExprErrorCode,
    | 'matches_pattern_too_long'
    | 'matches_pattern_syntax'
    | 'matches_pattern_unsupported'
    | 'matches_pattern_too_big'
  >;
  readonly params: Readonly<Record<string, string | number>>;
}

class Refuse extends Error {
  constructor(readonly problem: PatternProblem) {
    super(problem.code);
  }
}

const syntax = (detail: MatchesSyntaxProblem, at: number): Refuse =>
  new Refuse({ code: 'matches_pattern_syntax', params: { detail, at } });
const unsupported = (feature: MatchesUnsupportedFeature, at: number): Refuse =>
  new Refuse({ code: 'matches_pattern_unsupported', params: { feature, at } });
export const tooBig = (): Refuse =>
  new Refuse({ code: 'matches_pattern_too_big', params: { max: MATCHES_LIMITS.states } });
export { Refuse };

const DIGIT: readonly Range[] = [[48, 57]];
const WORD: readonly Range[] = [
  [48, 57],
  [65, 90],
  [95, 95],
  [97, 122],
];
// The set of JS `\s` (the same on every engine we compare with).
const SPACE: readonly Range[] = [
  [9, 13],
  [32, 32],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];
const LINE_END: readonly Range[] = [
  [10, 10],
  [13, 13],
  [0x2028, 0x2029],
];
const CONTROL: Readonly<Record<string, number>> = { n: 10, r: 13, t: 9, f: 12, v: 11 };
const SHORTHAND: Readonly<Record<string, readonly Range[]>> = { d: DIGIT, w: WORD, s: SPACE };
const PUNCT = '\\^$.|?*+()[]{}/';

const ch = (c: string): number => c.codePointAt(0) as number;
const literal = (cp: number): PatternNode => ({ k: 'set', set: { ranges: [[cp, cp]], negate: false } });

class Parser {
  private i = 0;
  constructor(private readonly cp: readonly string[]) {}

  parse(): PatternNode {
    const node = this.alt(0);
    if (this.i < this.cp.length) throw syntax('unmatched_paren', this.i);
    return node;
  }

  private peek(): string | undefined {
    return this.cp[this.i];
  }

  private alt(depth: number): PatternNode {
    const items = [this.cat(depth)];
    while (this.peek() === '|') {
      this.i++;
      items.push(this.cat(depth));
    }
    return items.length === 1 ? (items[0] as PatternNode) : { k: 'alt', items };
  }

  private cat(depth: number): PatternNode {
    const items: PatternNode[] = [];
    for (let c = this.peek(); c !== undefined && c !== '|' && c !== ')'; c = this.peek()) {
      const atom = this.atom(depth);
      items.push(this.quantified(atom));
    }
    return { k: 'cat', items };
  }

  private quantified(atom: PatternNode): PatternNode {
    const at = this.i;
    const c = this.peek();
    let min: number;
    let max: number | null;
    if (c === '*') [min, max] = [0, null];
    else if (c === '+') [min, max] = [1, null];
    else if (c === '?') [min, max] = [0, 1];
    else if (c === '{') [min, max] = this.bounds();
    else return atom;
    if (c !== '{') this.i++;
    if (atom.k === 'bol' || atom.k === 'eol') throw syntax('nothing_to_repeat', at);
    const next = this.peek();
    if (next === '?') throw unsupported('lazy_quantifier', this.i);
    if (next === '+') throw unsupported('possessive_quantifier', this.i);
    return { k: 'rep', node: atom, min, max };
  }

  /** `{m}`, `{m,}`, `{m,n}`; the cursor ends after the `}`. */
  private bounds(): [number, number | null] {
    const at = this.i;
    const m = /^\{(\d{1,4})(?:(,)(\d{0,4}))?\}/.exec(this.cp.slice(this.i, this.i + 14).join(''));
    if (!m) throw syntax('bad_repeat', at);
    const min = Number(m[1]);
    const max = m[2] === undefined ? min : m[3] === '' ? null : Number(m[3]);
    if (max !== null && min > max) throw syntax('bad_repeat', at);
    if (Math.max(min, max ?? 0) > MATCHES_LIMITS.repeatMax) throw tooBig();
    this.i += (m[0] as string).length;
    return [min, max];
  }

  private atom(depth: number): PatternNode {
    const at = this.i;
    const c = this.cp[this.i++] as string;
    switch (c) {
      case '(':
        return this.group(depth, at);
      case '[':
        return this.klass();
      case '.':
        return { k: 'set', set: { ranges: LINE_END, negate: true } };
      case '^':
        return { k: 'bol' };
      case '$':
        return { k: 'eol' };
      case '\\':
        return this.escape(at);
      case '*':
      case '+':
      case '?':
      case '{':
        throw syntax('nothing_to_repeat', at);
      case '}':
      case ']':
        throw syntax('bad_escape', at);
      default:
        return literal(ch(c));
    }
  }

  private group(depth: number, at: number): PatternNode {
    if (depth + 1 > MATCHES_LIMITS.groupDepth) throw syntax('nested_too_deep', at);
    if (this.peek() === '?') {
      const a = this.cp[this.i + 1];
      const b = this.cp[this.i + 2];
      if (a === ':') this.i += 2;
      else if (a === '=' || a === '!') throw unsupported('lookaround', at);
      else if (a === '<' && (b === '=' || b === '!')) throw unsupported('lookaround', at);
      else if (a === '<' || a === 'P' || a === "'") throw unsupported('named_group', at);
      else throw unsupported('group_flag', at);
    }
    const inner = this.alt(depth + 1);
    if (this.peek() !== ')') throw syntax('unclosed_group', at);
    this.i++;
    return inner;
  }

  private escape(at: number): PatternNode {
    const c = this.cp[this.i++];
    if (c === undefined) throw syntax('trailing_backslash', at);
    const lower = c.toLowerCase();
    if (lower === 'd' || lower === 'w' || lower === 's')
      return { k: 'set', set: { ranges: SHORTHAND[lower] as readonly Range[], negate: c !== lower } };
    if (c === 'b' || c === 'B') throw unsupported('word_boundary', at);
    if (c === 'p' || c === 'P') throw unsupported('unicode_property', at);
    if (c >= '1' && c <= '9') throw unsupported('backreference', at);
    return literal(this.escapedChar(c, at));
  }

  private escapedChar(c: string, at: number): number {
    const control = CONTROL[c];
    if (control !== undefined) return control;
    if (PUNCT.includes(c)) return ch(c);
    throw syntax('bad_escape', at);
  }

  private klass(): PatternNode {
    const at = this.i - 1;
    const negate = this.peek() === '^';
    if (negate) this.i++;
    const ranges: Range[] = [];
    while (this.peek() !== ']') {
      if (this.peek() === undefined) throw syntax('unclosed_class', at);
      const lo = this.classItem(ranges);
      if (lo === undefined) {
        if (this.peek() === '-' && this.cp[this.i + 1] !== ']') throw syntax('bad_range', this.i);
        continue;
      }
      if (this.peek() === '-' && this.cp[this.i + 1] !== ']' && this.cp[this.i + 1] !== undefined) {
        this.i++;
        const hiAt = this.i;
        const hi = this.classItem(ranges);
        if (hi === undefined || hi < lo) throw syntax('bad_range', hiAt);
        ranges.push([lo, hi]);
      } else ranges.push([lo, lo]);
    }
    this.i++;
    if (ranges.length === 0) throw syntax('empty_class', at);
    return { k: 'set', set: { ranges, negate } };
  }

  /** One class member: a code point, or `undefined` after adding a shorthand's ranges. */
  private classItem(into: Range[]): number | undefined {
    const at = this.i;
    const c = this.cp[this.i++] as string;
    if (c !== '\\') return ch(c);
    const e = this.cp[this.i++];
    if (e === undefined) throw syntax('trailing_backslash', at);
    if (e === 'd' || e === 'w' || e === 's') {
      into.push(...(SHORTHAND[e] as readonly Range[]));
      return undefined;
    }
    if (e === 'D' || e === 'W' || e === 'S') throw unsupported('shorthand_in_class', at);
    if (e === 'p' || e === 'P') throw unsupported('unicode_property', at);
    if (e === '-') return ch(e);
    return this.escapedChar(e, at);
  }
}

/** Parse a pattern. Total: returns a problem instead of throwing. */
export function parsePattern(
  pattern: string,
):
  | { readonly ok: true; readonly node: PatternNode }
  | { readonly ok: false; readonly problem: PatternProblem } {
  const cp = Array.from(pattern);
  if (cp.length > MATCHES_LIMITS.patternLength)
    return {
      ok: false,
      problem: { code: 'matches_pattern_too_long', params: { max: MATCHES_LIMITS.patternLength } },
    };
  try {
    return { ok: true, node: new Parser(cp).parse() };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, problem: e.problem };
    throw e;
  }
}
