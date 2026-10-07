// Every string of the Einstellungen sheet and the run notices is in the Paraglide catalogue with a real English
// translation (bug B2: v3 left English in German). Symbols and proper names that are the same in both are listed.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES = join(HERE, '..', '..', '..', '..', '..', 'messages');
const cat = (l: string): Record<string, string> =>
  JSON.parse(readFileSync(join(MESSAGES, `${l}.json`), 'utf8')) as Record<string, string>;
const de = cat('de');
const en = cat('en');
const mine = Object.keys(de).filter((k) => /^participant_(settings|signout|run)_/.test(k));
const SAME = new Set([
  'participant_settings_online',
  'participant_settings_offline',
  'participant_settings_tab_offline',
  'participant_settings_language_de',
  'participant_settings_language_en',
  ...['xs', 's', 'm', 'l', 'xl'].map((s) => `participant_settings_size_${s}`),
]);

describe('the settings catalogue', () => {
  it('has keys for the sheet', () => {
    expect(mine.length).toBeGreaterThan(30);
  });
  it.each(mine)('%s has a real English translation', (key) => {
    expect(en[key]).toBeTruthy();
    if (!SAME.has(key)) expect(en[key]).not.toBe(de[key]);
  });
  it('the components hold no literal UI text: every string goes through message()', () => {
    for (const f of readdirSync(HERE).filter((n) => n.endsWith('.svelte'))) {
      const src = readFileSync(join(HERE, f), 'utf8');
      const markup = src.slice(src.lastIndexOf('</script>'));
      // text between a tag's > and the next < or { that has letters
      expect(markup.match(/>\s*[A-Za-zÄÖÜäöü][^<>{}]*</g) ?? [], f).toEqual([]);
    }
  });
});
