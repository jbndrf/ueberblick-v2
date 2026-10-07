import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { specEnv } from './spec-env.mjs';

const SCRIPTS = join(import.meta.dirname, '..', '..', 'scripts'); // literal 'scripts': check:changed selects this guard
const SELF = join('testing', 'spec-env.spec.ts');
// The matcher runs on a masked copy of the spec (string and comment contents blanked out) and only trusts
// names the file imports from (node:)child_process, so db.exec( and re.exec( are never counted as spawns.
const CP_FNS: Record<string, true> = {
  spawn: true,
  spawnSync: true,
  execFile: true,
  execFileSync: true,
  exec: true,
  execSync: true,
  fork: true,
};
const CP_IMPORT = /import\s+([^'"]+?)\s*from\s*['"](?:node:)?child_process['"]/g;
const SPEC_ENV_IMPORT = /import\s*\{[^}]*\bspecEnv\b[^}]*\}\s*from/;
const ENV_KEY = /(?<![\w$.])env\s*:(?!=)/;
const ENV_SHORT = /(?:^|[{\[,])\s*env\s*[,}\]]/;

const NO_IMPORT = 'spawns a process but never imports specEnv';
const NO_ENV = 'spawn without env: pass env: specEnv()';
const RAW_ENV_WHY = 'passes process.env to a spawn: use specEnv()';

interface Finding {
  line: number;
  why: string;
}

/** Blanks string and comment contents (positions and newlines kept) so patterns cannot match inside them,
 *  except module specifiers, which the import matcher must still read. */
function mask(text: string): string {
  const out: string[] = text.split('');
  let quote: string | null = null;
  let keep = false;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (quote) {
      if (c === '\\') {
        if (keep) {
          out[i] = c;
          if (i + 1 < text.length) out[i + 1] = text.charAt(i + 1);
        } else {
          out[i] = ' ';
          if (i + 1 < text.length) out[i + 1] = text.charAt(i + 1) === '\n' ? '\n' : ' ';
        }
        i += 2;
        continue;
      }
      out[i] = keep ? c : c === '\n' ? '\n' : ' ';
      if (c === quote) {
        quote = null;
        keep = false;
      }
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      keep = c !== '`' && /(?:import|from)\s*\(?\s*$/.test(text.slice(0, i));
      i++;
      continue;
    }
    if (c === '/' && text.charAt(i + 1) === '/') {
      while (i < text.length && text.charAt(i) !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && text.charAt(i + 1) === '*') {
      out[i] = ' ';
      i++;
      while (i < text.length && !(text.charAt(i) === '*' && text.charAt(i + 1) === '/')) {
        out[i] = text.charAt(i) === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < text.length) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Index of the bracket that closes the bracket at `i`, or -1. */
function matchBracket(text: string, i: number): number {
  const open = text.charAt(i);
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text.charAt(j);
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth < 0) return -1;
      if (
        depth === 0 &&
        ((open === '(' && c === ')') || (open === '[' && c === ']') || (open === '{' && c === '}'))
      )
        return j;
    }
  }
  return -1;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charAt(i) === '\n') line++;
  return line;
}

/** Names bound to child_process: named imports (aliases included) and namespace or default importers. */
function cpBindings(masked: string): { named: string[]; qualified: string[] } {
  const named = new Set<string>();
  const qualified = new Set<string>();
  for (const [, clause = ''] of masked.matchAll(CP_IMPORT)) {
    const names = clause.match(/\{([^}]*)\}/)?.[1] ?? '';
    for (const part of names.split(',')) {
      const p = part.replace(/^type\s+/, '').trim();
      if (!p) continue;
      const [orig, local] = p.split(/\s+as\s+/);
      if (orig && CP_FNS[orig.trim()]) named.add((local ?? orig).trim());
    }
    const rest = clause
      .replace(/\{[^}]*\}/, ' ')
      .replace(/,/g, ' ')
      .trim();
    const ns = rest.match(/\*\s*as\s+([\w$]+)/)?.[1] ?? '';
    if (ns) {
      qualified.add(ns);
      continue;
    }
    if (/^[\w$]+$/.test(rest)) qualified.add(rest); // default import of the module object
  }
  return { named: [...named], qualified: [...qualified] };
}

/** Open-paren indexes of every call made through a child_process binding, including a newline before the (. */
function spawnCalls(masked: string, named: string[], qualified: string[]): number[] {
  const opens: number[] = [];
  for (const n of named)
    for (const m of masked.matchAll(new RegExp(`(?<![\\w$.])${n}\\s*\\(`, 'g')))
      if (m.index !== undefined) opens.push(m.index + m[0].length - 1);
  for (const b of qualified)
    for (const m of masked.matchAll(new RegExp(`(?<![\\w$.])${b}\\s*\\.\\s*[\\w$]+\\s*\\(`, 'g')))
      if (m.index !== undefined) opens.push(m.index + m[0].length - 1);
  return opens.sort((a, b) => a - b);
}

const RAW_ENV_READ = /(?:\.\.\.\s*)?process\s*(?:\.\s*env|\[\s*['"`]env['"`]\s*\])(?!\s*(?:\?\.|\.|\[))/;
const BLANK_KEY = /\[\s*['"`]\s+\]/g; // a subscript whose string mask() blanked (opening quote stays)

/** Bracket stack (as a string of openers) in force at `idx` of `text`. */
function stackAt(text: string, idx: number): string {
  const stack: string[] = [];
  for (const c of text.slice(0, idx)) {
    if ('([{'.includes(c)) stack.push(c);
    else if (')]}'.includes(c)) stack.pop();
  }
  return stack.join('');
}

/** End index of the expression that starts at `v`: the next comma or closer at the same depth. */
function valueEnd(text: string, v: number): number {
  for (let i = v; i < text.length; i++) {
    if (',)]}'.includes(text.charAt(i)) && stackAt(text.slice(v), i - v) === '') return i;
  }
  return text.length;
}

/** `masked` with `['env']` readable again (string contents are blanked) and the arguments of every
 *  specEnv(...) call blanked: a process.env read inside them is an override, not a hand-over. */
function envView(masked: string, original: string): string {
  const v = masked.split('');
  for (const m of masked.matchAll(BLANK_KEY)) {
    const at = m.index ?? 0;
    const k = original.slice(at, at + m[0].length).match(/['"`]env['"`]/);
    if (k && k.index !== undefined) for (let i = 0; i < 5; i++) v[at + k.index + i] = k[0].charAt(i);
  }
  let out = v.join('');
  for (const m of out.matchAll(/(?<![\w$.])specEnv\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = matchBracket(out, open);
    if (close > open)
      out = out.slice(0, open + 1) + out.slice(open + 1, close).replace(/[^\n]/g, ' ') + out.slice(close);
  }
  return out;
}

/** Does the call's own option object (depth 1 of its argument span) carry an env, and does that env hand
 *  over process.env: spread, plain, Object.assign, any conditional branch, or process['env']? */
function envCheck(masked: string, original: string, open: number): { has: boolean; raw: number | null } {
  const close = matchBracket(masked, open);
  if (close < 0) return { has: true, raw: null };
  const inner = masked.slice(open + 1, close);
  const atTop = (idx: number): boolean => stackAt(inner, idx) === '{';
  const key = [...inner.matchAll(new RegExp(ENV_KEY, 'g'))].find((m) => atTop(m.index ?? 0));
  if (!key || key.index === undefined) {
    const short = [...inner.matchAll(new RegExp(ENV_SHORT, 'g'))].find((m) =>
      atTop((m.index ?? 0) + m[0].indexOf('env')),
    );
    return { has: short !== undefined, raw: null };
  }
  const v = open + 1 + key.index + key[0].length;
  const view = envView(masked, original);
  const hit = view.slice(v, valueEnd(view, v)).match(RAW_ENV_READ);
  return { has: true, raw: hit && hit.index !== undefined ? v + hit.index : null };
}

/** Findings for one spec text: it spawns but never imports specEnv, a spawn without env, or a spawn that
 *  hands process.env (or a spread of it) to the child. */
function scanSpec(text: string): Finding[] {
  const masked = mask(text);
  const { named, qualified } = cpBindings(masked);
  const opens = spawnCalls(masked, named, qualified);
  if (opens.length === 0) return [];
  const found: Finding[] = [];
  const first = opens[0];
  if (first !== undefined && !SPEC_ENV_IMPORT.test(masked))
    found.push({ line: lineOf(masked, first), why: NO_IMPORT });
  for (const open of opens) {
    const { has, raw } = envCheck(masked, text, open);
    if (!has) found.push({ line: lineOf(masked, open), why: NO_ENV });
    if (raw !== null) found.push({ line: lineOf(masked, raw), why: RAW_ENV_WHY });
  }
  return found;
}

function specFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) specFiles(p, out);
    else if (/\.spec\.(?:ts|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const uebKeys = (env: NodeJS.ProcessEnv): string[] => Object.keys(env).filter((k) => k.startsWith('UEB_'));

describe('specEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('has no UEB_* key, even when the calling process has several set', () => {
    vi.stubEnv('UEB_LAND_KEY', 'outer');
    vi.stubEnv('UEB_LOCKED', '1');
    vi.stubEnv('UEB_TRAIN_MAX', '1');
    const env = specEnv();
    expect(uebKeys(env)).toEqual([]);
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('applies overrides: a spec that needs a UEB_* var sets it explicitly', () => {
    vi.stubEnv('UEB_LAND_KEY', 'outer');
    const env = specEnv({ UEB_TRAIN_MAX: '2' });
    expect(uebKeys(env)).toEqual(['UEB_TRAIN_MAX']);
    expect(env.UEB_TRAIN_MAX).toBe('2');
  });

  it('does not mutate process.env', () => {
    const before = JSON.stringify(process.env);
    specEnv({ UEB_X: '1' });
    expect(JSON.stringify(process.env)).toBe(before);
  });
});

describe('spec env guard: matcher', () => {
  const IMP = `import { specEnv } from '../testing/spec-env.mjs';\n`;
  const spawnRaw = `import { spawnSync } from 'node:child_process';\nspawnSync('bash', ['x'], { env: { ...process.env, A: '1' } });\n`;
  const spawnOk = `import { spawnSync } from 'node:child_process';\n${IMP}spawnSync('bash', ['x'], { env: specEnv({ A: '1' }) });\n`;
  /** A spawn without env must be flagged; these texts prove each binding form is seen as a spawn. */
  const noEnv = (t: string): void => expect(scanSpec(t).map((f) => f.why)).toContain(NO_ENV);
  const ok = (t: string): void => expect(scanSpec(t)).toEqual([]);

  it('flags a spread of process.env and env: process.env, accepts the same text using specEnv', () => {
    expect(scanSpec(spawnRaw)).toEqual([
      { line: 2, why: NO_IMPORT },
      { line: 2, why: RAW_ENV_WHY },
    ]);
    const plain = `import { execSync } from 'node:child_process';\nexecSync('x', { env: process.env });`;
    expect(scanSpec(plain)).toHaveLength(2);
    ok(spawnOk);
    ok(`import { spawn } from 'node:child_process';\n${IMP}spawn('x', ['a'], { env: specEnv() });`);
  });

  it('flags a spawn without env, even when the spec imports specEnv', () => {
    expect(scanSpec(`import { spawnSync } from 'node:child_process';\n${IMP}spawnSync('x');`)).toEqual([
      { line: 3, why: NO_ENV },
    ]);
  });

  it('accepts a shorthand env member and an env object spread from a specEnv value', () => {
    ok(
      `import { execFileSync } from 'node:child_process';\n${IMP}const env = specEnv({ X: '1' });\nexecFileSync('git', ['x'], { cwd: 'r', env });\nexecFileSync('git', ['y'], { env: { ...env, HOME: 'r' } });\n`,
    );
  });

  it('detects spawns through named aliases, namespaces, defaults, fork and a newline before (', () => {
    noEnv(`import { execFileSync as run } from 'node:child_process';\n${IMP}run('x');`);
    ok(`import { execFileSync as run } from 'node:child_process';\n${IMP}run('x', { env: specEnv() });`);
    noEnv(`import * as cp from 'node:child_process';\n${IMP}cp.exec('y');`);
    ok(
      `import * as cp from 'node:child_process';\n${IMP}cp.spawnSync('x', { env: specEnv() });\ncp.exec('y', { env: specEnv() });`,
    );
    noEnv(`import cp from 'node:child_process';\n${IMP}cp.spawnSync('x');`);
    ok(`import cp from 'node:child_process';\n${IMP}cp.spawnSync('x', { env: specEnv() });`);
    noEnv(`import { fork } from 'node:child_process';\n${IMP}fork('x');`);
    ok(`import { fork } from 'node:child_process';\n${IMP}fork('x', { env: specEnv() });`);
    noEnv(`import { spawn } from 'node:child_process';\n${IMP}spawn\n('x');`);
    ok(`import { spawn } from 'node:child_process';\n${IMP}spawn\n('x', { env: specEnv() });`);
  });

  it('ignores db.exec and re.exec, also in a spec that imports exec', () => {
    expect(
      scanSpec(`import { exec } from 'node:child_process';\n${IMP}db.exec('x'); const m = re.exec(t);`),
    ).toEqual([]);
    expect(scanSpec(`db.exec('x'); const m = re.exec(t);`)).toEqual([]);
  });

  it('flags process.env handed to a spawn over multiple lines', () => {
    const call = (env: string) =>
      `import { spawnSync } from 'node:child_process';\n${IMP}spawnSync('x', ['a'], {\n  env: ${env},\n});\n`;
    expect(scanSpec(call('{\n    ...process.env,\n  }'))).toEqual([{ line: 5, why: RAW_ENV_WHY }]);
    expect(scanSpec(call('{\n    ...\n    process.env,\n  }'))).toEqual([{ line: 5, why: RAW_ENV_WHY }]);
    expect(scanSpec(call('process.env'))).toEqual([{ line: 4, why: RAW_ENV_WHY }]);
  });

  describe('escapes of the raw-env check', () => {
    const CP = `import { spawnSync } from 'node:child_process';\n${IMP}`;
    const scan = (envValue: string) => scanSpec(`${CP}spawnSync('x', { env: ${envValue} });`);
    it.each([
      'Object.assign({}, process.env)',
      'c ? specEnv() : process.env',
      'c ? process.env : specEnv()',
      "process['env']",
      'process["env"]',
      "{ ...process['env'] }",
    ])('flags env: %s', (v) => expect(scan(v).map((f) => f.why)).toEqual([RAW_ENV_WHY]));
    it.each([
      'Object.assign({}, specEnv())',
      'c ? specEnv() : specEnv({ A: "1" })',
      "specEnv({ PATH: process['env'].PATH })",
      'specEnv({ PATH: process.env.PATH })',
      'specEnv({ PATH: `${bin}:${process.env.PATH}` })',
      '{ ...specEnv(), HOME: process.env.HOME }',
    ])('accepts env: %s', (v) => expect(scan(v)).toEqual([]));

    it('does not count a nested { env: … } as the call env', () => {
      const why = (t: string) => scanSpec(`${CP}${t}`).map((f) => f.why);
      expect(why(`spawnSync('x', { stdio: 'pipe', opts: { env: specEnv() } });`)).toEqual([NO_ENV]);
      expect(why(`spawnSync('x', [{ env: specEnv() }]);`)).toEqual([NO_ENV]);
      expect(why(`spawnSync('x', { opts: { env: process.env }, env: specEnv() });`)).toEqual([]);
    });
  });

  it('walks .spec.ts and .spec.mjs in a temp root: an .mjs spec that spawns without env is flagged', () => {
    const root = mkdtempSync(join(tmpdir(), 'spec-env-'));
    roots.push(root);
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'bad.spec.ts'), spawnRaw);
    writeFileSync(join(root, 'a', 'good.spec.ts'), spawnOk);
    writeFileSync(
      join(root, 'a.spec.mjs'),
      `import { execFileSync } from 'node:child_process';\nexecFileSync('node', ['x']);\n`,
    );
    writeFileSync(join(root, 'b.spec.mjs'), spawnOk);
    writeFileSync(join(root, 'c.txt'), spawnRaw);
    const files = specFiles(root);
    expect(files.map((f) => relative(root, f)).sort()).toHaveLength(4); // c.txt is skipped
    const bad = files.filter((f) => scanSpec(readFileSync(f, 'utf8')).length > 0);
    expect(bad.map((f) => relative(root, f)).sort()).toEqual(['a.spec.mjs', join('a', 'bad.spec.ts')]);
  });
});

describe('spec env guard: real tree', () => {
  it('every spawning spec in scripts/ uses specEnv and never passes process.env', () => {
    const problems: string[] = [];
    for (const file of specFiles(SCRIPTS)) {
      const rel = relative(SCRIPTS, file);
      if (rel === SELF) continue; // this file holds planted texts as strings
      for (const f of scanSpec(readFileSync(file, 'utf8')))
        problems.push(`scripts/${rel}:${f.line} ${f.why}`);
    }
    expect(problems).toEqual([]);
  });
});
