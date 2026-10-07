// WP-990/WP-991: the spec -> module import graph. Built once from the text of the files (static and dynamic
// imports, re-exports; package `exports`, `$lib`, .svelte, and the schema/golden data files that code imports with
// `?raw`), the way vite's module graph links them. `fanout.mjs` (the measurement tool) and `changed-select.mjs`
// (check:changed: which specs imported a deleted file at the merge-base) both use it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { messageEntries } from './rerun-triggers.mjs';

const CODE = /\.(ts|svelte|js|mjs)$/;
const EXT = ['.ts', '.svelte', '.js', '.mjs'];
const UI_ROOT = 'packages/ui/src/index.ts';

const DATA = /^(schema|fixtures\/golden)\/.*\.(json|ya?ml)$/;

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 << 20 })
    .split('\n')
    .filter(Boolean);

/** Repository files that can sit in an import graph: tracked and untracked, no `reference/`. */
export const codeFiles = (cwd) => [
  ...git(cwd, 'ls-files', '-co', '--exclude-standard').filter(
    (f) =>
      (CODE.test(f) || DATA.test(f) || f.endsWith('package.json')) &&
      !f.startsWith('reference/') &&
      existsSync(`${cwd}/${f}`),
  ),
  // the compiled Paraglide entries are git-ignored but real nodes: a messages change selects their importers
  ...Object.values(messageEntries(cwd)),
];

function parseClause(clause) {
  const c = clause.trim();
  const brace = /\{([^}]*)\}/.exec(c);
  const items = brace
    ? brace[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const types = items.filter((i) => /^type\s/.test(i));
  const values = items.filter((i) => !/^type\s/.test(i)).map((i) => i.split(/\s+as\s+/));
  return {
    c,
    values,
    allTypes: brace !== null && values.length === 0 && types.length > 0 && !/^[\w$]+\s*,/.test(c),
  };
}

/** Imports and re-exports of one file's text. */
export function parseModule(text) {
  const imports = []; // { spec, names: Set|null (all), inlineType }
  const reexports = []; // { spec, kind: star|ns|named, map: Map(exported -> source), exported }
  const body = text.replace(/^\s*(\*|\/\*|\/\/).*$/gm, '');
  const stmt = /(?:^|\n)[ \t]*(import|export)\b([^;'"`]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (const m of body.matchAll(stmt)) {
    const [, kw, clause, spec] = m;
    if (/^\s*type\b/.test(clause)) continue; // erased by esbuild
    if (kw === 'import') {
      const { c, values, allTypes } = parseClause(clause);
      if (/\*\s*as\b/.test(c)) imports.push({ spec, names: null, inlineType: false });
      else {
        const names = new Set(values.map(([n]) => n));
        if (/^[\w$]+/.test(c) && !c.startsWith('{')) names.add('default');
        imports.push({ spec, names: allTypes ? null : names, inlineType: allTypes });
      }
    } else if (/^\s*\*\s*$/.test(clause)) reexports.push({ spec, kind: 'star' });
    else if (/^\s*\*\s*as\s+([\w$]+)/.test(clause))
      reexports.push({ spec, kind: 'ns', exported: /as\s+([\w$]+)/.exec(clause)[1] });
    else {
      const map = new Map(parseClause(clause).values.map(([src, alias]) => [alias ?? src, src]));
      reexports.push({ spec, kind: 'named', map });
    }
  }
  for (const m of body.matchAll(/(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g))
    imports.push({ spec: m[1], names: null, inlineType: false });
  for (const m of body.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g))
    imports.push({ spec: m[1], names: null, inlineType: false });
  const own = new Set();
  for (const m of body.matchAll(
    /(?:^|\n)[ \t]*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function\*?|class|enum|interface|type)\s+([\w$]+)/g,
  ))
    own.add(m[1]);
  for (const m of body.matchAll(/(?:^|\n)[ \t]*export\s*\{([^}]*)\}\s*(?!from)/g)) {
    if (/^\s*from\b/.test(body.slice(m.index + m[0].length))) continue;
    for (const i of m[1].split(','))
      if (i.trim())
        own.add(
          i
            .trim()
            .split(/\s+as\s+/)
            .pop(),
        );
  }
  if (/(?:^|\n)[ \t]*export\s+default\b/.test(body)) own.add('default');
  return { imports, reexports, own };
}

/** The import graph of `files` (repository-relative; sources read from `cwd`). */
export function buildGraph(
  cwd,
  files,
  read = (f) => (existsSync(`${cwd}/${f}`) ? readFileSync(`${cwd}/${f}`, 'utf8') : ''),
) {
  const set = new Set(files);
  const packages = []; // { name, dir, exports }
  for (const f of files.filter((x) => x.endsWith('/package.json'))) {
    const j = JSON.parse(read(f));
    if (j.name && j.exports) packages.push({ name: j.name, dir: posix.dirname(f), exports: j.exports });
  }
  packages.sort((a, b) => b.name.length - a.name.length);
  const tryFile = (p) => {
    if (set.has(p) && (CODE.test(p) || DATA.test(p))) return p;
    const bare = p.replace(/\.(js|mjs)$/, '');
    for (const e of EXT) if (set.has(bare + e)) return bare + e;
    for (const e of EXT) if (set.has(`${p}/index${e}`)) return `${p}/index${e}`;
    return null;
  };
  const fromPackage = (spec) => {
    const pkg = packages.find((p) => spec === p.name || spec.startsWith(`${p.name}/`));
    if (!pkg) return null;
    const sub = spec === pkg.name ? '.' : `.${spec.slice(pkg.name.length)}`;
    for (const [key, target] of Object.entries(pkg.exports)) {
      if (typeof target !== 'string') continue;
      const star = key.indexOf('*');
      if (star < 0 ? key === sub : sub.startsWith(key.slice(0, star)) && sub.length >= key.length - 1) {
        const mid = star < 0 ? '' : sub.slice(star, sub.length - (key.length - star - 1));
        return tryFile(posix.join(pkg.dir, target.replace('*', mid)));
      }
    }
    return null;
  };
  const resolve = (spec, from) => {
    const s = spec.replace(/[?#].*$/, '');
    if (s.startsWith('.')) return tryFile(posix.join(posix.dirname(from), s));
    if (s.startsWith('$lib/') && from.startsWith('apps/web/'))
      return tryFile(`apps/web/src/lib/${s.slice(5)}`);
    return fromPackage(s);
  };
  const nodes = new Map();
  for (const f of files.filter((x) => DATA.test(x)))
    nodes.set(f, { imports: [], reexports: [], own: new Set() });
  for (const f of files.filter((x) => CODE.test(x))) {
    const m = parseModule(read(f));
    const edge = (e) => ({ ...e, to: resolve(e.spec, f) });
    nodes.set(f, {
      imports: m.imports.map(edge).filter((e) => e.to),
      reexports: m.reexports.map(edge).filter((e) => e.to),
      own: m.own,
    });
  }
  return { nodes, uiRoot: UI_ROOT, cache: new Map(), exportsCache: new Map() };
}

/** Names a module exports (own and re-exported), or null when unknown. */
function exportNames(g, f, seen = new Set()) {
  if (g.exportsCache.has(f)) return g.exportsCache.get(f);
  const n = g.nodes.get(f);
  if (!n || seen.has(f)) return new Set();
  seen.add(f);
  const out = new Set(n.own);
  for (const r of n.reexports) {
    if (r.kind === 'star') exportNames(g, r.to, seen).forEach((x) => out.add(x));
    else if (r.kind === 'ns') out.add(r.exported);
    else r.map.forEach((_, k) => out.add(k));
  }
  g.exportsCache.set(f, out);
  return out;
}

/** Re-exports of a barrel that serve `names`: [{ to, names: Set|null }]. */
function serving(g, node, names) {
  const out = [];
  for (const r of node.reexports) {
    if (r.kind === 'ns') {
      if (names.has(r.exported)) out.push({ to: r.to, names: null });
    } else if (r.kind === 'named') {
      const src = [...names].filter((n) => r.map.has(n)).map((n) => r.map.get(n));
      if (src.length) out.push({ to: r.to, names: new Set(src) });
    } else {
      const have = exportNames(g, r.to);
      const hit = [...names].filter((n) => have.has(n));
      if (hit.length) out.push({ to: r.to, names: new Set(hit) });
    }
  }
  return out;
}

/** Every module a spec's run loads, under `opts` ({ barrels: 'none'|'ui-root'|'all', eraseTypes }). */
function forward(g, spec, opts) {
  const seen = new Set();
  const done = new Map(); // file -> 'all' | Set of names followed
  const own = new Set();
  const stack = [[spec, null]];
  while (stack.length) {
    const [f, req] = stack.pop();
    const node = g.nodes.get(f);
    if (!node) continue;
    seen.add(f);
    const mode = opts.barrels ?? 'none';
    const filter =
      req !== null &&
      ((mode === 'all' && node.reexports.length > 0) || (mode === 'ui-root' && f === g.uiRoot));
    const prev = done.get(f);
    if (prev === 'all') continue;
    const pushImports = () => {
      for (const e of node.imports) if (!(opts.eraseTypes && e.inlineType)) stack.push([e.to, e.names]);
    };
    if (!filter) {
      done.set(f, 'all');
      pushImports();
      for (const r of node.reexports) stack.push([r.to, null]);
      continue;
    }
    const fresh = new Set([...req].filter((n) => !prev?.has(n)));
    if (!fresh.size) continue;
    done.set(f, new Set([...(prev ?? []), ...fresh]));
    if (!own.has(f)) {
      own.add(f);
      pushImports();
    }
    for (const s of serving(g, node, fresh)) stack.push([s.to, mode === 'ui-root' ? null : s.names]);
  }
  return seen;
}

const key = (o) => `${o.barrels ?? 'none'}:${o.eraseTypes ? 'e' : ''}`;
function forwardOf(g, spec, opts) {
  const k = key(opts);
  if (!g.cache.has(k)) g.cache.set(k, new Map());
  const c = g.cache.get(k);
  if (!c.has(spec)) c.set(spec, forward(g, spec, opts));
  return c.get(spec);
}

/** The specs (of `specs`) whose run loads at least one of `changed`; sorted. */
export function specsFor(g, specs, changed, opts = {}) {
  return specs.filter((s) => changed.some((f) => forwardOf(g, s, opts).has(f))).sort();
}

/** file -> number of specs whose run loads it. */
export function fanoutPerFile(g, specs, opts = {}) {
  const n = new Map();
  for (const s of specs) for (const f of forwardOf(g, s, opts)) n.set(f, (n.get(f) ?? 0) + 1);
  return n;
}

/**
 * The graph as the tree stood at `rev` (a commit): files from `git ls-tree`, texts from one `git cat-file --batch`.
 * Returns `{ g, files }`; throws when git cannot read the revision (the caller then runs every test).
 */
export function buildGraphAt(cwd, rev) {
  const keep = (f) =>
    (CODE.test(f) || DATA.test(f) || f.endsWith('package.json')) && !f.startsWith('reference/');
  const files = git(cwd, 'ls-tree', '-r', '--name-only', rev).filter(keep);
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd,
    input: files.map((f) => `${rev}:${f}\n`).join(''),
    maxBuffer: 1 << 30,
  });
  const texts = new Map();
  let at = 0;
  for (const f of files) {
    const nl = out.indexOf(10, at);
    const [, type, size] = out.subarray(at, nl).toString('utf8').split(' ');
    if (type !== 'blob') throw new Error(`git cat-file: ${rev}:${f} is no blob`);
    texts.set(f, out.subarray(nl + 1, nl + 1 + Number(size)).toString('utf8'));
    at = nl + 1 + Number(size) + 1;
  }
  return { g: buildGraph(cwd, files, (f) => texts.get(f) ?? ''), files };
}
