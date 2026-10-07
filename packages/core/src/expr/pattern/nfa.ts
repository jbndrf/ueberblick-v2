/**
 * Thompson NFA for the `matches` pattern subset: compile once, then match in O(text length x states) with no
 * backtracking, so no pattern can be slow on any text (R14, H4). Matching is a search (a match anywhere in the
 * text, as CEL's `matches`); `^` and `$` anchor to the text start and end.
 */
import { MATCHES_LIMITS } from '../../registry/expr-matches';
import { parsePattern, Refuse, tooBig, type CharSet, type PatternNode, type PatternProblem } from './parse';

const CHAR = 0;
const SPLIT = 1;
const BOL = 2;
const EOL = 3;
const MATCH = 4;

interface State {
  readonly t: number;
  out: number;
  out1: number;
  readonly set: CharSet | undefined;
}

class Builder {
  readonly states: State[] = [];

  add(t: number, out: number, out1: number, set?: CharSet): number {
    if (this.states.length >= MATCHES_LIMITS.states) throw tooBig();
    this.states.push({ t, out, out1, set });
    return this.states.length - 1;
  }

  /** The start state of `node` followed by `next`. Built backwards, so no patch lists are needed. */
  emit(node: PatternNode, next: number): number {
    switch (node.k) {
      case 'set':
        return this.add(CHAR, next, -1, node.set);
      case 'bol':
        return this.add(BOL, next, -1);
      case 'eol':
        return this.add(EOL, next, -1);
      case 'cat': {
        let cur = next;
        for (let i = node.items.length - 1; i >= 0; i--) cur = this.emit(node.items[i] as PatternNode, cur);
        return cur;
      }
      case 'alt': {
        let cur = this.emit(node.items[node.items.length - 1] as PatternNode, next);
        for (let i = node.items.length - 2; i >= 0; i--)
          cur = this.add(SPLIT, this.emit(node.items[i] as PatternNode, next), cur);
        return cur;
      }
      case 'rep':
        return this.rep(node.node, node.min, node.max, next);
    }
  }

  private rep(node: PatternNode, min: number, max: number | null, next: number): number {
    let cur: number;
    if (max === null) {
      const loop = this.add(SPLIT, -1, next);
      const body = this.emit(node, loop);
      (this.states[loop] as State).out = body;
      cur = loop;
    } else {
      cur = next;
      for (let i = min; i < max; i++) cur = this.add(SPLIT, this.emit(node, cur), next);
    }
    for (let i = 0; i < min; i++) cur = this.emit(node, cur);
    return cur;
  }
}

/** One state of the lazily built DFA: a set of NFA states, and what the text can do from it. */
interface DState {
  readonly list: Int32Array;
  /** The set holds the MATCH state: a match ends here. */
  readonly match: boolean;
  /** At the end of the text, with the `$` states of the set resolved, the set matches. */
  readonly endMatch: boolean;
  /** Next DFA state per ASCII code, undefined until computed. */
  readonly next: (DState | undefined)[];
  readonly other: Map<number, DState>;
}

/** The states as flat arrays, plus the buffers and the DFA cache a run reuses (core is single-threaded). */
export interface Program {
  readonly kind: Uint8Array;
  readonly out: Int32Array;
  readonly out1: Int32Array;
  readonly sets: readonly (CharSet | undefined)[];
  /** `ascii[id * 128 + c]` is 1 when the character state `id` accepts the ASCII code `c`. */
  readonly ascii: Uint8Array;
  readonly start: number;
  readonly buf: {
    readonly mark: Int32Array;
    readonly stack: Int32Array;
    readonly tmp: Int32Array;
    gen: number;
  };
  readonly dfa: { index: Map<string, DState>; first: DState | undefined; transitions: number };
}

const inSet = (set: CharSet, cp: number): boolean => {
  let hit = false;
  for (const [lo, hi] of set.ranges)
    if (cp >= lo && cp <= hi) {
      hit = true;
      break;
    }
  return hit !== set.negate;
};

function flatten(states: readonly State[], start: number): Program {
  const n = states.length;
  const kind = new Uint8Array(n);
  const out = new Int32Array(n);
  const out1 = new Int32Array(n);
  const ascii = new Uint8Array(n * 128);
  const sets: (CharSet | undefined)[] = [];
  states.forEach((st, id) => {
    kind[id] = st.t;
    out[id] = st.out;
    out1[id] = st.out1;
    sets.push(st.set);
    if (st.set) for (let c = 0; c < 128; c++) ascii[id * 128 + c] = inSet(st.set, c) ? 1 : 0;
  });
  const buf = {
    tmp: new Int32Array(n),
    mark: new Int32Array(n),
    stack: new Int32Array(n),
    gen: 0,
  };
  return {
    kind,
    out,
    out1,
    sets,
    ascii,
    start,
    buf,
    dfa: { index: new Map(), first: undefined, transitions: 0 },
  };
}

/** Compile a pattern; the problem names the `EXPR_ERRORS` code. */
export function compilePattern(
  pattern: string,
):
  | { readonly ok: true; readonly program: Program }
  | { readonly ok: false; readonly problem: PatternProblem } {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) return parsed;
  const b = new Builder();
  try {
    const match = b.add(MATCH, -1, -1);
    return { ok: true, program: flatten(b.states, b.emit(parsed.node, match)) };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, problem: e.problem };
    throw e;
  }
}

/**
 * Add `s` and every state reachable from it without consuming a character to `list` (a state at most once per
 * `gen`). A `$` state is left in the list while `atEnd` is false: only the end of the text can pass it.
 */
function close(
  p: Program,
  list: Int32Array,
  count: number,
  s: number,
  atStart: boolean,
  atEnd: boolean,
): number {
  const { kind, out, out1, buf } = p;
  const { mark, stack, gen } = buf;
  let top = 0;
  if (mark[s] !== gen) {
    mark[s] = gen;
    stack[top++] = s;
  }
  while (top > 0) {
    const id = stack[--top] as number;
    const k = kind[id];
    if (k === CHAR || k === MATCH || (k === EOL && !atEnd)) {
      list[count++] = id;
      continue;
    }
    if (k === SPLIT) {
      const y = out1[id] as number;
      if (mark[y] !== gen) {
        mark[y] = gen;
        stack[top++] = y;
      }
    } else if (k === BOL && !atStart) continue;
    const x = out[id] as number;
    if (mark[x] !== gen) {
      mark[x] = gen;
      stack[top++] = x;
    }
  }
  return count;
}

/** The DFA state for the NFA states in `tmp[0..n)`; `first` marks the state at the start of the text. */
function intern(p: Program, n: number, first: boolean): DState {
  const { tmp } = p.buf;
  const ids = Array.from(tmp.subarray(0, n)).sort((x, y) => x - y);
  const key = `${first ? 'S' : ''}${ids.join(',')}`;
  const hit = p.dfa.index.get(key);
  if (hit) return hit;
  const match = ids.some((id) => p.kind[id] === MATCH);
  let endMatch = match;
  if (!match)
    for (const id of ids) {
      if (p.kind[id] !== EOL) continue;
      p.buf.gen++;
      const m = close(p, p.buf.tmp, 0, p.out[id] as number, first, true);
      for (let i = 0; i < m && !endMatch; i++) endMatch = p.kind[p.buf.tmp[i] as number] === MATCH;
    }
  const state: DState = {
    list: Int32Array.from(ids),
    match,
    endMatch,
    next: new Array<DState | undefined>(128).fill(undefined),
    other: new Map(),
  };
  // past the cap a state is used once and not remembered, so memory stays bounded and a run stays O(text x states)
  if (p.dfa.index.size < MATCHES_LIMITS.dfaStates) p.dfa.index.set(key, state);
  return state;
}

/** The state after reading code point `cp` in state `from`, plus a fresh start (search semantics). */
function step(p: Program, from: DState, cp: number): DState {
  const { kind, out, sets, ascii, start, buf } = p;
  buf.gen++;
  let n = 0;
  for (const id of from.list) {
    if (kind[id] !== CHAR) continue;
    const hit = cp < 128 ? ascii[id * 128 + cp] === 1 : inSet(sets[id] as CharSet, cp);
    if (hit) n = close(p, buf.tmp, n, out[id] as number, false, false);
  }
  n = close(p, buf.tmp, n, start, false, false);
  return intern(p, n, false);
}

/**
 * Does `program` match anywhere in `text`? A lazily built DFA over the NFA: each character costs one table
 * lookup once its transition is known, and building a transition is O(states), so a run is O(text length x
 * states) in the worst case. No backtracking, so no pattern is slow on any text. The cache is bounded.
 */
export function runProgram(p: Program, text: string): boolean {
  const { dfa, buf } = p;
  if (dfa.index.size >= MATCHES_LIMITS.dfaStates || dfa.transitions >= MATCHES_LIMITS.dfaTransitions) {
    dfa.index.clear();
    dfa.first = undefined;
    dfa.transitions = 0;
  }
  if (!dfa.first) {
    buf.gen++;
    dfa.first = intern(p, close(p, buf.tmp, 0, p.start, true, false), true);
  }
  const len = text.length;
  let state = dfa.first;
  let pos = 0;
  while (pos < len) {
    if (state.match) return true;
    const cp = text.codePointAt(pos) as number;
    pos += cp > 0xffff ? 2 : 1;
    let nx = cp < 128 ? state.next[cp] : state.other.get(cp);
    if (!nx) {
      nx = step(p, state, cp);
      if (dfa.index.size < MATCHES_LIMITS.dfaStates && dfa.transitions < MATCHES_LIMITS.dfaTransitions) {
        dfa.transitions++;
        if (cp < 128) state.next[cp] = nx;
        else state.other.set(cp, nx);
      }
    }
    state = nx;
  }
  return state.endMatch;
}

const cache = new Map<string, ReturnType<typeof compilePattern>>();

/** `compilePattern`, remembered (a pattern is a literal in a config, so a handful repeat for every feature). */
export function patternProgram(pattern: string): ReturnType<typeof compilePattern> {
  let hit = cache.get(pattern);
  if (!hit) {
    hit = compilePattern(pattern);
    if (cache.size >= MATCHES_LIMITS.programs) cache.clear();
    cache.set(pattern, hit);
  }
  return hit;
}

/** What the caches hold now, for the specs that prove the memory caps (`MATCHES_LIMITS`). */
export function cacheStats(pattern: string): { programs: number; states: number; transitions: number } {
  const hit = cache.get(pattern);
  const dfa = hit?.ok ? hit.program.dfa : undefined;
  return { programs: cache.size, states: dfa?.index.size ?? 0, transitions: dfa?.transitions ?? 0 };
}
