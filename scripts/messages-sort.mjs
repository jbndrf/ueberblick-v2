// Sorts Paraglide message files alphabetically ($schema first), so parallel branches
// that add keys with different prefixes do not conflict at the end of the file.
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Key order every messages file must follow. */
export function sortedKeys(keys) {
  return [...keys].sort((a, b) => {
    if (a === '$schema') return b === '$schema' ? 0 : -1;
    if (b === '$schema') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function isSorted(text) {
  const keys = Object.keys(JSON.parse(text));
  return sortedKeys(keys).every((k, i) => k === keys[i]);
}

export function sortMessages(text) {
  const obj = JSON.parse(text);
  const out = {};
  for (const k of sortedKeys(Object.keys(obj))) out[k] = obj[k];
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Every catalogue folder: one per package (`packages/*`, `packages/tools/*`, `apps/*`), found by readdir, so a
 * new package or a third-party tool is picked up without a list to edit. Folders that do not exist are skipped.
 * The one list both `messages:sort` and the UI-strings lint read (R1).
 */
export function catalogueDirs(root = '.') {
  return ['packages', 'packages/tools', 'apps'].flatMap((parent) => {
    let entries = [];
    try {
      entries = readdirSync(join(root, parent), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && existsSync(join(root, parent, e.name, 'messages')))
      .map((e) => join(root, parent, e.name, 'messages'));
  });
}

/** Paths of every messages/*.json in every catalogue folder under `root`. */
export function messageFiles(root = '.') {
  return catalogueDirs(root).flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(dir, f)),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const f of messageFiles()) {
    const before = readFileSync(f, 'utf8');
    const after = sortMessages(before);
    if (after !== before) {
      writeFileSync(f, after);
      console.log(`messages:sort: ${f}`);
    }
  }
}
