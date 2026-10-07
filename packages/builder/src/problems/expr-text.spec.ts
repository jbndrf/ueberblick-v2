import { describe, expect, it } from 'vitest';
import {
  EXPR_ERRORS,
  EXPR_FOUND_KINDS,
  MATCHES_SYNTAX_PROBLEMS,
  MATCHES_UNSUPPORTED_FEATURES,
  type Problem,
} from '@ueberblick/core';
import { openProject } from '../doc';
import { musterstadt } from '../testing/golden';
import { messages, type MessageKey } from '../shell/messages';
import { exprHintKey, problemText } from './text';

const LOCALES = ['de', 'en'] as const;

const exists = (locale: string, key: string): boolean => {
  const text = messages(locale)(key as MessageKey, {});
  return text !== key && text !== `builder_${key}` && text.length > 0;
};

/** Every message key the expression error registry asks for, with its hint keys. */
const keys: readonly string[] = [
  ...EXPR_ERRORS.entries.flatMap((e) => [
    `expr_${e.key}`,
    ...e.hints.map((variant) => exprHintKey(e.key, variant)),
  ]),
  ...EXPR_FOUND_KINDS.keys.filter((k) => k !== 'token').map((k) => `expr_found_${k}`),
  ...MATCHES_SYNTAX_PROBLEMS.keys.map((k) => `expr_matches_syntax_${k}`),
  ...MATCHES_UNSUPPORTED_FEATURES.keys.map((k) => `expr_matches_unsupported_${k}`),
];

describe('expression error messages: completeness (WP-421)', () => {
  for (const locale of LOCALES) {
    it(`every expression error code, hint variant and found kind has a ${locale} text`, () => {
      expect(keys.filter((key) => !exists(locale, key))).toEqual([]);
    });
  }

  it('the German text is German: no entry equals its English text', () => {
    const same = keys.filter(
      (k) => messages('de')(k as MessageKey, {}) === messages('en')(k as MessageKey, {}),
    );
    expect(same).toEqual([]);
  });

  it('German and English use the same params in each text', () => {
    const names = new Set(EXPR_ERRORS.entries.flatMap((e) => e.params));
    const used = (locale: string, key: string): string[] =>
      [...names].filter((n) => messages(locale)(key as MessageKey, { [n]: '@@' }).includes('@@')).sort();
    const differing = keys.filter((k) => JSON.stringify(used('de', k)) !== JSON.stringify(used('en', k)));
    expect(differing).toEqual([]);
  });
});

/** The problems the compiler reports when the `when` of the task `kontrolle` is `source`. */
function problemsOf(source: string): Problem[] {
  const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc).apply({
    kind: 'set',
    path: 'tasks.kontrolle.when',
    value: source,
  }).doc;
  return doc.problems().filter((p) => p.path === 'tasks.kontrolle.when');
}

describe('problemText: expression problems in German and English (WP-421)', () => {
  it('words a matches pattern problem with its own wording, never the registry key', () => {
    const [p] = problemsOf("'abc'.matches('(a')");
    const de = problemText(p as Problem, 'de').message;
    expect(de).toContain('eine Gruppe „(“ wird nicht geschlossen');
    expect(de).not.toContain('unclosed_group');
    const [q] = problemsOf("'abc'.matches('(?=a)')");
    expect(problemText(q as Problem, 'de').message).toContain('ein Vor- oder Rückblick');
    expect(problemText(q as Problem, 'en').message).toContain('a look-ahead or look-behind');
  });

  it('words a type mismatch with the values filled in', () => {
    const [p] = problemsOf('1 + 1');
    expect(p?.code).toBe('expression_type');
    const de = problemText(p as Problem, 'de');
    expect(de.message).toBe(
      'Der Ausdruck „1 + 1“ passt nicht: Erwartet wird bool, der Ausdruck ergibt aber int.',
    );
    const en = problemText(p as Problem, 'en');
    expect(en.message).toBe('The expression "1 + 1" does not fit: Expected bool but the expression is int.');
  });

  it('words an unknown name with its suggestion, in German', () => {
    const [p] = problemsOf('selff.stage == 1');
    expect(p?.code).toBe('expression_type');
    const de = problemText(p as Problem, 'de');
    expect(de.message).toContain('Der Name „selff“ ist hier nicht bekannt.');
    expect(de.hint).toBe('Meinten Sie „self“?');
    expect(problemText(p as Problem, 'en').hint).toBe('Did you mean "self"?');
  });

  it('words an unknown property with the available ones, in German', () => {
    const [p] = problemsOf('self.gibt_es_nicht == 1');
    const de = problemText(p as Problem, 'de');
    expect(de.message).toMatch(/hat keine Eigenschaft „gibt_es_nicht“\.$/);
    expect(de.hint).toMatch(/^(Meinten Sie|Vorhanden sind:) /);
  });

  it('words a parse error in German and English, with what was found', () => {
    const [p] = problemsOf('(1 2');
    expect(p?.code).toBe('expression_parse');
    expect(problemText(p as Problem, 'de').message).toBe(
      'Der Ausdruck „(1 2“ ist nicht lesbar (Stelle 3): Hier wird „)“ erwartet, gefunden wurde eine Zahl.',
    );
    expect(problemText(p as Problem, 'en').message).toContain('Expected ")" here but found a number.');
  });

  it('words a found token and the end of the expression', () => {
    const [token] = problemsOf('1 )');
    expect(problemText(token as Problem, 'de').message).toContain('Unerwartet: „)“.');
    const [end] = problemsOf('(1');
    expect(problemText(end as Problem, 'de').message).toContain('gefunden wurde das Ende des Ausdrucks.');
  });

  it('puts no English detail in the German text', () => {
    for (const source of ['1 + 1', 'selff.stage == 1', '(1 2', 'self.stage > 3']) {
      for (const p of problemsOf(source)) {
        const text = problemText(p, 'de');
        expect(text.message, source).not.toMatch(/expected|unknown|does not|cannot|but the/i);
        expect(text.hint ?? '', source).not.toMatch(/did you mean|expected|available:/i);
      }
    }
  });
});
