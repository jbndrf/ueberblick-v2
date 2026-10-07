// WP-147: no wall-clock assertions in unit specs. Budgets are measured in bench/ through `defineBudget`;
// a `*.spec.ts` under packages/ or apps/ asserts behaviour only, because time asserts flake under load.
//
// The heuristic (documented in docs/12-performance-budgets.md):
//   1. clock read  = performance.now(), Date.now(), process.hrtime(...), hrtime.bigint()
//   2. seed        = a variable assigned exactly one clock read (`const t = performance.now()`)
//   3. elapsed     = a clock read minus a seed/clock, or a seed minus a clock (`performance.now() - t`)
//   4. tainted     = a variable assigned from, or pushed with, an expression holding an elapsed value
//                    or another tainted variable (`ms`, `best = Math.min(best, ...)`, `times.push(...)`)
//   5. violation   = `expect(<expr with an elapsed value or tainted variable>)` chained to
//                    toBeLessThan(OrEqual) / toBeGreaterThan(OrEqual) / toBeCloseTo
// A clock that only feeds a log line, an id or a timestamp is fine. Comments and string contents are ignored.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPlanted } from '../testing/plant.mjs';

export interface WallclockViolation {
  /** Path relative to the scanned root, with `/`. */
  file: string;
  line: number;
}

const CLOCK = String.raw`(?:performance\.now\s*\(\s*\)|Date\.now\s*\(\s*\)|(?:process\.)?hrtime(?:\.bigint)?\s*\([^)]*\))`;
const HAS_CLOCK = new RegExp(CLOCK);
const ID = String.raw`[A-Za-z_$][\w$]*`;
const MATCHER =
  /^\s*(?:\.not)?\.(?:toBeLessThan|toBeLessThanOrEqual|toBeGreaterThan|toBeGreaterThanOrEqual|toBeCloseTo)\s*\(/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.svelte-kit', '.git', 'bench', 'reference']);

/** Blanks comments and string contents, keeping every offset and newline in place. */
function strip(src: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p: string) => p + blank(m.slice(p.length)))
    .replace(
      /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
      (m) => m[0] + blank(m.slice(1, -1)) + m.slice(-1),
    );
}

/** The text of the parenthesis group opening at `open` (the index of "("), or undefined when unbalanced. */
function group(text: string, open: number): { inner: string; end: number } | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  return undefined;
}

/** Line numbers of every wall-clock assertion in one spec source. */
export function wallclockAssertLines(source: string): number[] {
  const text = strip(source);
  if (!HAS_CLOCK.test(text)) return [];
  const statements = text.split(/[;{}]/);
  const assign = new RegExp(
    String.raw`(?:^|\s)(?:(?:const|let|var)\s+)?(${ID})\s*(?::[^=]+)?=\s*([^=][\s\S]*)$`,
  );
  const exact = new RegExp(`^\\s*${CLOCK}\\s*$`);
  const seeds = new Set<string>();
  for (const s of statements) {
    const m = assign.exec(s);
    if (m?.[1] && m[2] !== undefined && exact.test(m[2])) seeds.add(m[1]);
  }
  const seedAlt = [...seeds].join('|');
  const elapsedParts = [
    `${CLOCK}\\s*-\\s*(?:${CLOCK}|${ID})`,
    ...(seedAlt ? [`\\b(?:${seedAlt})\\s*-\\s*${CLOCK}`, `\\b(?:${seedAlt})\\s*-\\s*(?:${seedAlt})\\b`] : []),
    String.raw`(?:process\.)?hrtime\s*\(\s*[^)\s][^)]*\)`,
  ];
  const elapsed = new RegExp(elapsedParts.join('|'));
  const tainted = new Set<string>();
  const holdsElapsed = (expr: string): boolean =>
    elapsed.test(expr) ||
    [...tainted].some((t) =>
      new RegExp(`(?<![\\w$]|(?<!\\.)\\.)${t.replace(/\$/g, '\\$')}(?![\\w$])`).test(expr),
    );
  const push = new RegExp(String.raw`(${ID})\s*\.\s*push\s*\(([\s\S]*)$`);
  for (let changed = true; changed;) {
    changed = false;
    for (const s of statements) {
      const target = assign.exec(s);
      const pushed = push.exec(s);
      const name = pushed?.[1] ?? target?.[1];
      const rhs = pushed?.[2] ?? target?.[2];
      if (name && rhs !== undefined && !tainted.has(name) && !seeds.has(name) && holdsElapsed(rhs)) {
        tainted.add(name);
        changed = true;
      }
    }
  }
  const lines: number[] = [];
  const expects = /\bexpect\s*\(/g;
  for (let m = expects.exec(text); m; m = expects.exec(text)) {
    const g = group(text, m.index + m[0].length - 1);
    if (g && MATCHER.test(text.slice(g.end)) && holdsElapsed(g.inner))
      lines.push(text.slice(0, m.index).split('\n').length);
  }
  return lines;
}

function* specFiles(dir: string, rel: string, includePlants: boolean): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a plant or temp dir removed between listing and reading
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!includePlants && isPlanted(r)) continue;
    if (e.isDirectory()) yield* specFiles(join(dir, e.name), r, includePlants);
    else if (e.isFile() && e.name.endsWith('.spec.ts')) yield r;
  }
}

/**
 * Scans `packages/**` and `apps/**` `*.spec.ts` under `root` (never `bench/`). Plants (WP-138) are skipped
 * unless `includePlants` is set, which the guardrail's own spec uses on a temp root.
 */
export function findWallclockAsserts(
  root: string,
  opts: { includePlants?: boolean } = {},
): WallclockViolation[] {
  const out: WallclockViolation[] = [];
  for (const top of ['packages', 'apps']) {
    for (const file of specFiles(join(root, top), top, opts.includePlants ?? false)) {
      let src: string;
      try {
        src = readFileSync(join(root, file), 'utf8');
      } catch {
        continue;
      }
      for (const line of wallclockAssertLines(src)) out.push({ file, line });
    }
  }
  return out;
}
