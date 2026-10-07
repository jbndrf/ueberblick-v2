#!/usr/bin/env node
// Glossary lint: rejects v3 vocabulary in packages/ and apps/ (docs/01-glossary.md, CLAUDE.md R7).
// Identifiers are split into words, so `ToolConfigSchema` and `field_values` are caught like prose.
// Comments and string literals are scanned too (the whole line is).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlanted } from './testing/plant.mjs';

const config = JSON.parse(readFileSync(new URL('./glossary-terms.json', import.meta.url), 'utf8'));

function phraseRe(words) {
  const parts = words.split(' ').map((w, i, all) => {
    const last = i === all.length - 1;
    if (last && w.endsWith('*')) return `${w.slice(0, -1)}[a-z0-9]*`;
    return last ? `${w}s?` : w;
  });
  return new RegExp(`(?<![a-z0-9])${parts.join(' ')}(?![a-z0-9])`);
}

const terms = config.banned.map((t) => ({ re: phraseRe(t.words), use: t.use, words: t.words }));
const allow = config.allow ?? [];

/** Splits identifiers (camel, Pascal, snake, kebab) into lowercase, space-separated words. */
export function toWords(line) {
  return line
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .toLowerCase();
}

/** Returns human-readable problems for one file's text. */
export function checkText(text, file) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (line.includes('glossary-lint-ignore')) return;
    const words = toWords(line);
    for (const t of terms) {
      const m = words.match(t.re);
      if (!m) continue;
      if (allow.some((a) => a.words === t.words && file.startsWith(a.file))) continue;
      out.push(`${file}:${i + 1} uses "${m[0]}" (banned v3 term) — use ${t.use} (R7)`);
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
    if (e === 'node_modules' || e.startsWith('.') || e === 'dist' || e === 'build' || isPlanted(e)) continue; // plants: scripts/testing/plant.mjs
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|svelte|js|mjs)$/.test(e)) acc.push(p);
  }
  return acc;
}

/** Scans the repo once. Returns the problems plus what it did, so tests can assert work, not wall time. */
export function scanRepo(roots = ['packages', 'apps']) {
  const files = roots.flatMap((d) => walk(d));
  const reads = [];
  let bytes = 0;
  const problems = files.flatMap((f) => {
    const text = readFileSync(f, 'utf8');
    reads.push(f);
    bytes += Buffer.byteLength(text);
    return checkText(text, f);
  });
  return { problems, files, reads, bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems } = scanRepo();
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\nglossary-lint: ${problems.length} problem(s). See docs/01-glossary.md.`);
    process.exit(1);
  }
  console.log('glossary-lint: ok');
}
