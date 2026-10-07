import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = import.meta.dirname;
const files = readdirSync(dir).filter((f) => /\.(ts|svelte)$/.test(f) && !f.includes('.spec.'));
const svelte = files.filter((f) => f.endsWith('.svelte'));

describe('the editor is lazy-loaded', () => {
  it('only editor.ts imports CodeMirror', () => {
    for (const f of files) {
      const code = readFileSync(join(dir, f), 'utf8');
      expect(/from\s+'@codemirror\//.test(code) || /import\s+'@codemirror\//.test(code), f).toBe(
        f === 'editor.ts',
      );
    }
  });

  it('CodeEditor.svelte loads editor.ts with a dynamic import only', () => {
    const code = readFileSync(join(dir, 'CodeEditor.svelte'), 'utf8');
    expect(code).toMatch(/import\('\.\/editor'\)/);
    expect(code).not.toMatch(/^\s*import\s+(?!type)[^;]*from\s+'\.\/editor'/m);
  });
});

describe('the Code view goes through Paraglide', () => {
  const strip = (code: string): string =>
    code.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  it.each(svelte)('%s has no literal user-visible text', (file) => {
    let markup = strip(readFileSync(join(dir, file), 'utf8'));
    for (let prev = ''; prev !== markup;) {
      prev = markup;
      markup = markup.replace(/\{[^{}]*\}/g, '');
    }
    const text = [...markup.matchAll(/>([^<>]+)</g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((s) => /\p{L}/u.test(s));
    const attrs = [
      ...strip(readFileSync(join(dir, file), 'utf8')).matchAll(
        /\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g,
      ),
    ];
    expect(text).toEqual([]);
    expect(attrs).toEqual([]);
  });
});
