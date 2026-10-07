// WP-992: what a barrel edit did. A barrel is a file whose statements are all re-exports (`export ... from`,
// `export * from`, `export type ... from`), plus comments and blank lines. `barrelDiff(before, after)` parses both
// versions with TypeScript's parser (no regex on exports) and says which exports were added, removed or changed.
// check:changed (changed-select.mjs) selects no importers for a barrel that only gained named re-exports.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';

/**
 * Parse one version. `null` when it is not a barrel (any statement other than a re-export) or cannot be parsed.
 * @returns {Map<string, { source: string, from: string }> | null} export key -> where it comes from. A named
 *   export's key is its exported name; `export *` has the key `*<specifier>` so that adding or removing it shows.
 */
export function parseBarrel(text) {
  const sf = ts.createSourceFile('barrel.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  if (sf.parseDiagnostics?.length) return null;
  const out = new Map();
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier))
      return null;
    const from = st.moduleSpecifier.text;
    const type = st.isTypeOnly ? 'type:' : '';
    const clause = st.exportClause;
    if (!clause) out.set(`*${from}`, { source: `${type}*`, from });
    else if (ts.isNamespaceExport(clause)) out.set(clause.name.text, { source: `${type}*`, from });
    else
      for (const el of clause.elements) {
        const t = el.isTypeOnly ? 'type:' : type;
        out.set(el.name.text, { source: `${t}${(el.propertyName ?? el.name).text}`, from });
      }
  }
  return out;
}

/**
 * @param {string} before the barrel at the merge-base
 * @param {string} after the barrel now
 * @returns {{ barrel: boolean, added: { name: string, from: string }[], removed: string[], changed: string[] }}
 *   `barrel` is false when either version is no barrel. An `export *` added or removed counts as `changed` (it can
 *   shadow or reveal names). A name that now comes from another module, or under another name or kind, is `changed`.
 */
export function barrelDiff(before, after) {
  const a = parseBarrel(before);
  const b = parseBarrel(after);
  if (!a || !b) return { barrel: false, added: [], removed: [], changed: [] };
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of b) {
    const was = a.get(k);
    if (k.startsWith('*')) {
      if (!was) changed.push(k);
    } else if (!was) added.push({ name: k, from: v.from });
    else if (was.from !== v.from || was.source !== v.source) changed.push(k);
  }
  for (const k of a.keys()) if (!b.has(k)) (k.startsWith('*') ? changed : removed).push(k);
  return { barrel: true, added, removed, changed };
}

const EXTS = ['.ts', '.mts', '.svelte', '.js', '.mjs'];
const gitOk = (cwd, rev, file) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${rev}:${file}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const gitShow = (cwd, rev, file) => {
  try {
    return execFileSync('git', ['show', `${rev}:${file}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 << 20,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};
const isFile = (f) => existsSync(f) && statSync(f).isFile();

/**
 * The module a new re-export points at, when it is a file that exists now and did not exist at `base` (so the
 * barrel's importers never loaded it); else null.
 */
function newTarget(cwd, barrel, from, { base, head }) {
  if (!from.startsWith('.')) return null;
  const hit = candidatesOf(barrel, from).find(nowOf(cwd, head));
  return hit && !gitOk(cwd, base, hit) ? hit : null;
}

/** Files a relative specifier from `fromFile` may name, in resolution order. */
function candidatesOf(fromFile, spec) {
  const p = posix.join(posix.dirname(fromFile), spec);
  const bare = p.replace(/\.(js|mjs)$/, '');
  return [
    ...(EXTS.some((e) => p.endsWith(e)) ? [p] : []),
    ...EXTS.map((e) => bare + e),
    ...EXTS.map((e) => `${p}/index${e}`),
  ];
}
const nowOf = (cwd, head) => (f) => (head ? gitOk(cwd, head, f) : isFile(`${cwd}/${f}`));
const readNow = (cwd, head, f) => (head ? gitShow(cwd, head, f) : readFileSync(`${cwd}/${f}`, 'utf8'));

const bindingNames = (n, out) => {
  if (ts.isIdentifier(n)) out.push(n.text);
  else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))
    for (const el of n.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
};

/**
 * Export names a module offers to `export *` (never `default`), following its own `export *` for `levels` more
 * levels. Null when it cannot be resolved or parsed, or a star lies beyond `levels`.
 */
function starNames(cwd, file, spec, opts, levels) {
  if (!spec.startsWith('.')) return null;
  const f = candidatesOf(file, spec).find(nowOf(cwd, opts.head));
  const text = f && readNow(cwd, opts.head, f);
  if (!text) return null;
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  if (sf.parseDiagnostics?.length) return null;
  const names = new Set();
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      const c = st.exportClause;
      if (c && ts.isNamespaceExport(c)) names.add(c.name.text);
      else if (c) c.elements.forEach((el) => names.add(el.name.text));
      else if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        if (!levels) return null;
        const inner = starNames(cwd, f, st.moduleSpecifier.text, opts, levels - 1);
        if (!inner) return null;
        inner.forEach((n) => names.add(n));
      }
      continue;
    }
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;
    if (ts.isVariableStatement(st)) {
      const out = [];
      st.declarationList.declarations.forEach((d) => bindingNames(d.name, out));
      out.forEach((n) => names.add(n));
    } else if ('name' in st && st.name && ts.isIdentifier(st.name)) names.add(st.name.text);
  }
  return names;
}

/** Why an added name is no safe addition: it shadows an `export *` name, or a star cannot be read. Else null. */
function shadowed(cwd, file, now, added, opts) {
  for (const [k, v] of parseBarrel(now) ?? []) {
    if (!k.startsWith('*')) continue;
    const names = starNames(cwd, file, v.from, opts, 1);
    if (!names) return `export * from '${v.from}' cannot be read (unresolved, unparsable or nested too deep)`;
    const hit = added.find((a) => names.has(a.name));
    if (hit) return `added '${hit.name}' shadows export * from '${v.from}'`;
  }
  return null;
}

/**
 * Is this changed file a barrel that only gained named re-exports of brand-new modules? Only then can its importers
 * not be affected: before the edit the barrel did not load those modules, and every user of a new name is a changed
 * file itself. Anything else (a removal, a re-pointed name, `export *` added or removed, a non-re-export
 * statement, an added line for a module that already existed, a new or unparsable barrel, no base) returns null:
 * the import graph decides. A local named export wins over the same name from an `export *`, so an added name that
 * an `export *` target of the barrel offers (parsed one level deep plus one nested level; unreadable or deeper:
 * unknown) would silently re-point importers: not additive. `opts.note(text)` receives why.
 * @returns {{ added: number, targets: string[] } | null} `targets`: the new modules the added lines point at
 */
export function additiveBarrel(cwd, file, opts = {}) {
  const { base, head, note } = opts;
  if (!base || !/\.(ts|mts|js|mjs)$/.test(file)) return null;
  const now = head
    ? gitShow(cwd, head, file)
    : isFile(`${cwd}/${file}`)
      ? readFileSync(`${cwd}/${file}`, 'utf8')
      : null;
  // R14: most changed files are no barrel; the cheap parse of the new text rules them out before git is asked
  if (now === null || !/^\s*export\b/m.test(now) || !parseBarrel(now)) return null;
  const was = gitShow(cwd, base, file);
  if (was === null) return null;
  const d = barrelDiff(was, now);
  if (!d.barrel || d.removed.length || d.changed.length) return null;
  const why = d.added.length ? shadowed(cwd, file, now, d.added, opts) : null;
  if (why) {
    note?.(`check:changed barrel ${file}: ${why} -> importers`);
    return null;
  }
  const targets = d.added.map((a) => newTarget(cwd, file, a.from, { base, head }));
  return targets.every(Boolean) ? { added: d.added.length, targets } : null;
}
