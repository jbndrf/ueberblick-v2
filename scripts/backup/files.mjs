// Incremental mirror of a folder tree: copies what is missing or differs in size, removes what the source no longer has.
// Blobs are content-addressed and immutable, so size is enough. Deletions are mirrored because an erasure deletes blob
// bytes and a backup must not keep them. An empty or missing source never wipes the backup (a wrong mount must not
// erase the only copy).
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PARTIAL = '.partial';

/** Relative paths of all files below `root`. */
function listFiles(root, rel = '') {
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) out.push(...listFiles(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** Mirrors `src` into `dst`. Returns { copied, removed }. */
export function syncTree(src, dst) {
  if (!existsSync(src)) return { copied: 0, removed: 0 };
  const have = listFiles(src);
  if (have.length === 0) return { copied: 0, removed: 0 };
  mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const rel of have) {
    const to = join(dst, rel);
    if (existsSync(to) && statSync(to).size === statSync(join(src, rel)).size) continue;
    mkdirSync(join(to, '..'), { recursive: true });
    // rename is atomic: a half-copied file never looks complete
    copyFileSync(join(src, rel), to + PARTIAL);
    renameSync(to + PARTIAL, to);
    copied += 1;
  }
  const keep = new Set(have);
  let removed = 0;
  for (const rel of listFiles(dst)) {
    if (keep.has(rel)) continue;
    rmSync(join(dst, rel));
    if (!rel.endsWith(PARTIAL)) removed += 1;
  }
  return { copied, removed };
}
