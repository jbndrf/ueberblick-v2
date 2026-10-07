/**
 * Incremental text index behind `DeviceStore.searchText`: per (type, property) a sorted array of
 * normalised word tokens plus postings (token -> feature ids). A lookup binary-searches the first token of the
 * prefix and walks only the tokens that start with it, so a keystroke never scans the features (R14).
 * Built like spatial.ts: puts and deletes touch only the tokens of one feature. In memory only; the store
 * registers sources after open and the index is rebuilt from the hydrated features.
 */
import type { FeatureId, FeatureState, Json, Key } from '@ueberblick/core/model';
import type { TextSource } from './contract';
import { isServed } from '@ueberblick/core/registry';

const MARKS = /\p{M}/gu;
const NON_WORD = /[^\p{L}\p{N}]+/u;

/** NFD, diacritics stripped, lower-cased: the one folding both the index and the query use. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(MARKS, '').toLowerCase();
}

/** Distinct word tokens of a text, normalised. */
export function tokenize(s: string): string[] {
  const out = new Set<string>();
  for (const w of normalizeText(s).split(NON_WORD)) if (w.length > 0) out.add(w);
  return [...out];
}

/** Tokens of one property value; only text and numbers are searchable. */
export function valueTokens(v: Json | undefined): string[] {
  return typeof v === 'string' || typeof v === 'number' ? tokenize(String(v)) : [];
}

/** Most features have one id per token, so a single id is stored inline and a Set only when needed. */
type Posting = FeatureId | Set<FeatureId>;

function lowerBound(a: readonly string[], x: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((a[mid] as string) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The index of one (type, property). */
class TokenIndex {
  private tokens: string[] = [];
  private readonly postings = new Map<string, Posting>();

  add(id: FeatureId, toks: readonly string[]): void {
    for (const t of toks) {
      const cur = this.postings.get(t);
      if (cur === undefined) {
        this.postings.set(t, id);
        const at = lowerBound(this.tokens, t);
        this.tokens.splice(at, 0, t);
      } else if (typeof cur === 'string') {
        if (cur !== id) this.postings.set(t, new Set([cur, id]));
      } else cur.add(id);
    }
  }

  remove(id: FeatureId, toks: readonly string[]): void {
    for (const t of toks) {
      const cur = this.postings.get(t);
      if (cur === undefined) continue;
      if (typeof cur === 'string') {
        if (cur !== id) continue;
      } else {
        cur.delete(id);
        if (cur.size > 0) continue;
      }
      this.postings.delete(t);
      const at = lowerBound(this.tokens, t);
      if (this.tokens[at] === t) this.tokens.splice(at, 1);
    }
  }

  /** Bulk build: postings first, then one sort of the distinct tokens (no splice per token). */
  build(entries: Iterable<readonly [FeatureId, readonly string[]]>): void {
    this.clear();
    for (const [id, toks] of entries) {
      for (const t of toks) {
        const cur = this.postings.get(t);
        if (cur === undefined) this.postings.set(t, id);
        else if (typeof cur === 'string') {
          if (cur !== id) this.postings.set(t, new Set([cur, id]));
        } else cur.add(id);
      }
    }
    this.tokens = [...this.postings.keys()].sort();
  }

  clear(): void {
    this.tokens = [];
    this.postings.clear();
  }

  /**
   * Rough cost of walking `prefix`: postings summed over its tokens, stopping at `cap` postings or `cap`
   * tokens (a wide prefix is priced as `cap`). Picks the most selective word of a multi-word query.
   */
  cost(prefix: string, cap: number): number {
    let total = 0;
    let seen = 0;
    for (let i = lowerBound(this.tokens, prefix); i < this.tokens.length && seen < cap; i++, seen++) {
      const t = this.tokens[i] as string;
      if (!t.startsWith(prefix)) return total;
      const p = this.postings.get(t);
      total += p === undefined ? 0 : typeof p === 'string' ? 1 : p.size;
      if (total >= cap) return cap;
    }
    return seen >= cap ? cap : total;
  }

  /** Ids of every token starting with `prefix`, in token order; `visit` returns true to stop. */
  walk(prefix: string, visit: (id: FeatureId) => boolean): void {
    for (let i = lowerBound(this.tokens, prefix); i < this.tokens.length; i++) {
      const t = this.tokens[i] as string;
      if (!t.startsWith(prefix)) return;
      const p = this.postings.get(t);
      if (p === undefined) continue;
      if (typeof p === 'string') {
        if (visit(p)) return;
      } else for (const id of p) if (visit(id)) return;
    }
  }
}

/** A prefix with more postings or tokens than this is priced as this many. */
const WIDE = 2000;

const keyOf = (type: Key, property: string): string => `${type}\u0000${property}`;

export class TextIndexes {
  private readonly bySource = new Map<string, TokenIndex>();
  private readonly byType = new Map<Key, { property: string; index: TokenIndex }[]>();

  constructor(private readonly features: ReadonlyMap<FeatureId, FeatureState>) {}

  /** Registers a source and bulk-builds it from the features held (O(N), once at open). Idempotent. */
  register(type: Key, property: string): void {
    const k = keyOf(type, property);
    if (this.bySource.has(k)) return;
    const index = new TokenIndex();
    this.bySource.set(k, index);
    const list = this.byType.get(type) ?? [];
    list.push({ property, index });
    this.byType.set(type, list);
    index.build(this.tokensOfType(type, property));
  }

  private *tokensOfType(type: Key, property: string): Generator<readonly [FeatureId, readonly string[]]> {
    for (const f of this.features.values())
      if (f.type === type && isServed(f.lifecycle)) yield [f.id, valueTokens(f.properties[property])];
  }

  has(source: TextSource): boolean {
    return this.bySource.has(keyOf(source.type, source.property));
  }

  /** Call with the committed feature before it changes (`prev`) and after (`next`); either may be undefined. */
  update(prev: FeatureState | undefined, next: FeatureState | undefined): void {
    if (prev && isServed(prev.lifecycle))
      for (const { property, index } of this.byType.get(prev.type) ?? [])
        index.remove(prev.id, valueTokens(prev.properties[property]));
    if (next && isServed(next.lifecycle))
      for (const { property, index } of this.byType.get(next.type) ?? [])
        index.add(next.id, valueTokens(next.properties[property]));
  }

  clear(): void {
    for (const i of this.bySource.values()) i.clear();
  }

  private mostSelective(sources: readonly TextSource[], words: readonly string[]): string {
    const [head = '', ...others] = words;
    if (others.length === 0) return head;
    let best = head;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const w of words) {
      let cost = 0;
      for (const s of sources) {
        const index = this.bySource.get(keyOf(s.type, s.property));
        if (index) cost = Math.min(WIDE, cost + index.cost(w, WIDE));
        if (cost >= bestCost) break;
      }
      if (cost < bestCost) {
        best = w;
        bestCost = cost;
      }
    }
    return best;
  }

  /**
   * Committed features whose searched values hold, for every word of `query`, a word starting with it.
   * The most selective word (fewest postings) drives the index walk; the others are checked on the feature. `skip` drops ids.
   */
  search(
    sources: readonly TextSource[],
    words: readonly string[],
    limit: number,
    skip: (id: FeatureId) => boolean,
  ): FeatureId[] {
    const out: FeatureId[] = [];
    const first = this.mostSelective(sources, words);
    const rest = words.filter((w) => w !== first);
    const seen = new Set<FeatureId>();
    for (const s of sources) {
      const index = this.bySource.get(keyOf(s.type, s.property));
      if (!index || out.length >= limit) continue;
      index.walk(first, (id) => {
        if (seen.has(id) || skip(id)) return false;
        seen.add(id);
        const f = this.features.get(id);
        if (f && matchesWords(f, sources, rest)) out.push(id);
        return out.length >= limit;
      });
    }
    return out;
  }
}

/** True when every word starts some word of the feature's values of the sources of its type. */
export function matchesWords(
  f: FeatureState,
  sources: readonly TextSource[],
  words: readonly string[],
): boolean {
  if (words.length === 0) return true;
  const toks = sources.filter((s) => s.type === f.type).flatMap((s) => valueTokens(f.properties[s.property]));
  return words.every((w) => toks.some((t) => t.startsWith(w)));
}
