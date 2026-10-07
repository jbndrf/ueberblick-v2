#!/usr/bin/env node
// UI-strings lint (WP-910): a string quoted in docs/user must exist in a message catalogue.
// Convention (docs/user/README.md): UI labels are quoted "like this" (en, straight quotes) or „so“ (de).
// Code spans and fenced code are not scanned. `<!-- ui-strings-ignore -->` on a line exempts its quotes.
// `*.en.md` is checked against en.json, all other pages against de.json. Catalogue `{param}` matches any
// text; a doc quote ending in `...` or `…` is an abbreviation and matches as a prefix.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogueDirs } from './messages-sort.mjs';
import { isPlanted } from './testing/plant.mjs';

export const IGNORE_MARK = '<!-- ui-strings-ignore -->';
const QUOTE_RE = /"([^"\n]+)"|„([^“”\n]+)[“”]/g;
const PARAM_RE = /\{[^}]*\}/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Turns one catalogue value into a matcher. `{param}` is any text. */
export function patternOf(value) {
  const src = value.replace(/\.$/, '').split(new RegExp(PARAM_RE, 'g')).map(esc).join('.+?');
  return new RegExp(`^${src}\\.?$`, 's'); // a sentence's final full stop is often left out when quoting
}

/** Loads the values of one locale from every catalogue folder (one Paraglide catalogue per package, WP-586). */
export function loadCatalogue(locale, dirs = catalogueDirs()) {
  const values = [];
  for (const d of dirs) {
    let json;
    try {
      json = JSON.parse(readFileSync(join(d, `${locale}.json`), 'utf8'));
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(json))
      if (!k.startsWith('$') && typeof v === 'string') values.push(v);
  }
  // A value that is only parameters ("{detail_hint}") would match any text: it is no pattern (2026-10-03).
  const literal = (v) => v.replace(new RegExp(PARAM_RE, 'g'), '').replace(/[\s.]/g, '') !== '';
  return { exact: new Set(values), patterns: values.filter(literal).map(patternOf), values };
}

/** True when the quoted text is (an abbreviation of) a catalogue message. */
export function isKnown(text, cat) {
  const t = text.trim();
  if (cat.exact.has(t) || cat.exact.has(`${t}.`) || cat.patterns.some((re) => re.test(t))) return true;
  const m = t.match(/^(.*?)\s*(?:\.\.\.|…)$/s);
  if (!m || !m[1]) return false;
  const head = m[1];
  // "Retrying in …" abbreviates "Retrying in {s} s": compare with the parameters spelled as "N".
  return cat.values.some(
    (v) => v.startsWith(head) || v.replace(new RegExp(PARAM_RE, 'g'), 'N').startsWith(head),
  );
}

/** The catalogue spelling when `text` differs from a catalogue label only by `…` vs `...`, else null. */
export function ellipsisSpelling(text, cat) {
  const t = text.trim();
  const swapped = t.endsWith('…') ? `${t.slice(0, -1)}...` : t.endsWith('...') ? `${t.slice(0, -3)}…` : null;
  return swapped && cat.exact.has(swapped) && !cat.exact.has(t) ? swapped : null;
}

/** Returns `file:line: "<text>" is in no message catalogue` for one page. */
export function checkDoc(text, file, cat) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced || line.includes(IGNORE_MARK)) return;
    const prose = line.replace(/`[^`\n]*`/g, '');
    for (const m of prose.matchAll(QUOTE_RE)) {
      const q = m[1] ?? m[2];
      const spelled = ellipsisSpelling(q, cat);
      if (spelled)
        out.push(`${file}:${i + 1}: "${q}" differs from the catalogue only in …/...: use "${spelled}"`);
      else if (!isKnown(q, cat)) out.push(`${file}:${i + 1}: "${q}" is in no message catalogue`);
    }
  });
  return out;
}

function walk(dir, acc = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.startsWith('.') || isPlanted(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (e.endsWith('.md')) acc.push(p);
  }
  return acc;
}

/**
 * Scans docs/user once. `dirs` are the catalogue folders, so tests can plant their own. `only` limits the scan to
 * these paths (the pre-commit hook passes the staged docs, so an older worktree is never failed for a doc it did
 * not touch when the shared hook's rules grow, WP-977).
 */
export function scanDocs(root = 'docs/user', dirs = catalogueDirs(), only = undefined) {
  const cats = { de: loadCatalogue('de', dirs), en: loadCatalogue('en', dirs) };
  const files = only ? only.filter((f) => f.startsWith(`${root}/`) && f.endsWith('.md')) : walk(root);
  const problems = files.flatMap((f) =>
    checkDoc(readFileSync(f, 'utf8'), f, f.endsWith('.en.md') ? cats.en : cats.de),
  );
  return { problems, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const { problems } = scanDocs(undefined, undefined, args.length ? args : undefined);
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\nui-strings-lint: ${problems.length} problem(s). See docs/user/README.md.`);
    process.exit(1);
  }
  console.log('ui-strings-lint: ok');
}
