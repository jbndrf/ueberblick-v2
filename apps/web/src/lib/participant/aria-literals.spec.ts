/**
 * WP-713: no hard-coded words in accessible names. An `aria-label`, `title`, `placeholder`, `alt` or a screen-reader
 * only text in the participant app and in the kit it uses comes from a message catalogue (Paraglide), never from a
 * literal: German and English users hear their own language.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const DIRS = ['apps/web/src/lib/participant', 'packages/ui/src'];
/** The admin tables and the carousel are not part of the participant app (no screen of it uses them). */
const SKIP = ['packages/ui/src/components/admin/', 'packages/ui/src/components/ui/carousel/'];
const TESTING = /\.(spec|testing)\.|[\\/](e2e|testing|paraglide)[\\/]/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (isPlanted(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(svelte|ts)$/.test(name) && !TESTING.test(path) ? [path] : [];
  });
}

/** A word in an accessible position: `aria-label="Close"`, `title='x'`, `ariaLabel: 'x'`, `<span class="sr-only">Close`. */
const LITERALS = [
  /\b(aria-label|aria-description|title|placeholder|alt)=("[A-Za-zÄÖÜäöü][^"]*"|'[A-Za-zÄÖÜäöü][^']*')/,
  /\{\s*(aria-label|ariaLabel|title|placeholder|alt)\s*:\s*['"`][A-Za-zÄÖÜäöü]/,
  /class="sr-only"[^>]*>\s*[A-Za-zÄÖÜäöü]/,
];

describe('accessible names (WP-713)', () => {
  const found = DIRS.flatMap((d) => sources(join(ROOT, d)))
    .filter((f) => !SKIP.some((s) => relative(ROOT, f).split(sep).join('/').startsWith(s)))
    .flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          LITERALS.some((re) => re.test(line)) ? [`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );

  it('has no literal text in an aria-label, title, placeholder, alt or sr-only element', () => {
    expect(found).toEqual([]);
  });
});
