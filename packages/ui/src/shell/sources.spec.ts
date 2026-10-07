import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

describe('shell sources', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter((f) => /\.(svelte|ts)$/.test(f) && !f.endsWith('.spec.ts'));

  it('import no map or form code (performance: nothing eager)', () => {
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      const imports = src
        .split('\n')
        .filter((l) => /^\s*(import|export)\b.*from/.test(l))
        .join('\n');
      expect(imports, f).not.toMatch(/maplibre|packages\/tools|form-renderer/i);
    }
  });

  it('stay under 400 lines', () => {
    for (const f of files)
      expect(readFileSync(new URL(f, dir), 'utf8').split('\n').length, f).toBeLessThan(400);
  });

  it('svelte files have no literal user-visible text', () => {
    for (const f of files.filter((x) => x.endsWith('.svelte'))) {
      const src = readFileSync(new URL(f, dir), 'utf8')
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
      const text = [...src.matchAll(/>([^<>]+)</g)]
        .map((m) => (m[1] ?? '').trim())
        .filter((t) => /\p{L}/u.test(t));
      expect(text, f).toEqual([]);
      expect([...src.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g)], f).toEqual([]);
    }
  });
});
