// The runtime image runs scripts/tls/*.mjs (the entrypoint and the TLS front). WP-954 and WP-964 added origin.mjs and
// redirect.mjs, the Dockerfile's hand-kept COPY list missed both, and the image crashed at start (2026-10-02). This
// spec walks what the entrypoint runs and every relative import from there, and checks the Dockerfile copies it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Repo paths the runtime stage copies from the build context: `COPY <src>... <dest>` without --from, globs kept. */
function copiedSources(dockerfile: string): string[] {
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
  return runtime
    .split('\n')
    .filter((l) => /^COPY\s/.test(l) && !/--from=/.test(l))
    .flatMap((l) => l.trim().split(/\s+/).slice(1, -1));
}

const globToRe = (g: string) =>
  new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
const isCopied = (path: string, sources: string[]) => sources.some((s) => globToRe(s).test(path));

/** Every repo file the given scripts load: the files themselves plus relative static and dynamic imports, recursively. */
function closure(entries: string[]): string[] {
  const seen = new Set<string>();
  const todo = [...entries];
  while (todo.length) {
    const file = todo.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const dep = relative(root, join(root, dirname(file), m[1] as string));
      if (existsSync(join(root, dep))) todo.push(dep);
    }
  }
  return [...seen].sort();
}

/** Scripts the entrypoint runs with node (`node scripts/....mjs`). */
const entrypointScripts = (sh: string) =>
  [...sh.matchAll(/node\s+(scripts\/[\w./-]+\.mjs)/g)].map((m) => m[1] as string);

describe('Dockerfile copies every script the runtime image runs', () => {
  const dockerfile = read('Dockerfile');
  const sources = copiedSources(dockerfile);
  const needed = closure(entrypointScripts(read('scripts/docker/entrypoint.sh')));

  it('finds the entrypoint scripts and their imports', () => {
    expect(needed).toEqual(expect.arrayContaining(['scripts/tls/front.mjs', 'scripts/tls/origin.mjs']));
    expect(needed).toContain('scripts/tls/redirect.mjs');
  });

  it('copies each of them into the runtime stage', () => {
    expect(needed.filter((p) => !isCopied(p, sources))).toEqual([]);
  });

  it('a hand-kept list that misses a module fails', () => {
    const planted = dockerfile.replace(
      /^COPY scripts\/tls\/.*$/m,
      'COPY scripts/tls/front.mjs ./scripts/tls/',
    );
    expect(needed.filter((p) => !isCopied(p, copiedSources(planted)))).toContain('scripts/tls/origin.mjs');
  });
});
