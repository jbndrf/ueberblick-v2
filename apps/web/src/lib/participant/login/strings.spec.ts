import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WP-609: no user-facing string is written into the markup; each one is a Paraglide message.
const HERE = dirname(fileURLToPath(import.meta.url));
const markup = (file: string): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

describe.each(['LoginPage.svelte', 'QrTab.svelte'])('%s', (file) => {
  it('has no literal text between tags', () => {
    const text = [...markup(file).matchAll(/>([^<>{}]*[A-Za-zÄÖÜäöüß]{2,}[^<>{}]*)</g)].map((m) =>
      m[1]?.trim(),
    );
    expect(text).toEqual([]);
  });

  it('has no literal words in user-facing attributes', () => {
    const attrs = [
      ...markup(file).matchAll(/\b(?:aria-label|placeholder|alt|title)="([^"{]*[A-Za-z]{2,}[^"]*)"/g),
    ];
    expect(attrs.map((m) => m[1])).toEqual([]);
  });
});

describe('the catalogue', () => {
  it('has every login text in German and English', () => {
    const read = (l: string) =>
      Object.keys(
        JSON.parse(readFileSync(join(HERE, '../../../../messages', `${l}.json`), 'utf8')) as object,
      ).filter((k) => k.startsWith('participant_login_'));
    expect(read('de')).toEqual(read('en'));
    expect(read('de').length).toBeGreaterThan(30);
  });
});
