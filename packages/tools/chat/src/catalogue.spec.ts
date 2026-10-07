import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translator } from './messages';

const catalogue = (locale: string) =>
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'messages', `${locale}.json`), 'utf8'),
  ) as Record<string, string>;

describe('chat catalogue', () => {
  it('has the same keys in German and English, none empty', () => {
    const de = catalogue('de');
    const en = catalogue('en');
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const v of [...Object.values(de), ...Object.values(en)]) expect(v.length).toBeGreaterThan(0);
  });

  it("uses v3's German strings verbatim (chat-v3-inventory §2)", () => {
    const t = translator('de');
    expect(t('empty')).toBe('Noch keine Nachrichten. Sag doch hallo!');
    expect(t('mention_label')).toBe('Jemanden erwähnen');
    expect(t('mention_empty')).toBe('Keine Teilnehmer:innen');
    expect(t('placeholder')).toBe('Nachricht…');
    expect(t('you')).toBe('Du');
    expect(t('unknown')).toBe('Unbekannt');
    expect(t('not_member')).toBe('Der Projekt-Chat ist für deine Rolle nicht verfügbar.');
  });

  it('anything that is not German is English', () => {
    expect(translator('fr')('you')).toBe('You');
    expect(translator('de-AT')('you')).toBe('Du');
  });
});
