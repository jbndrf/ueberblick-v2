import { describe, expect, it } from 'vitest';
import {
  DANGLING_KINDS,
  PROBLEM_CODES,
  PROBLEM_VARIANTS,
  merge,
  problemsFromMergeIssues,
  type Problem,
  type ProblemParams,
} from '@ueberblick/core';
import { openProject } from '../doc';
import { musterstadt } from '../testing/golden';
import { messages, type MessageKey } from '../shell/messages';
import { problemItems } from './model';
import { problemKey, problemText } from './text';

const LOCALES = ['de', 'en'] as const;
const HAS_NO_HINT: readonly string[] = ['schema_invalid'];

/** Every message key the registries ask for: code, code and variant, plus their hints. */
const wordings: readonly string[] = [
  ...PROBLEM_CODES.keys.map((code) => problemKey(code, undefined)),
  ...PROBLEM_VARIANTS.keys.map((k) => {
    const [code, variant] = k.split('.') as [(typeof PROBLEM_CODES.keys)[number], string];
    return problemKey(code, variant);
  }),
];

/** Message keys exist when the compiled message is not the key itself. */
const exists = (locale: string, key: string): boolean => {
  const text = messages(locale)(key as MessageKey, {});
  return text !== key && text !== `builder_${key}` && text.length > 0;
};

describe('problem messages: completeness (WP-416)', () => {
  for (const locale of LOCALES) {
    it(`every problem code and variant has a ${locale} message`, () => {
      const missing = wordings.filter((key) => !exists(locale, key));
      expect(missing).toEqual([]);
    });

    it(`every problem code and variant has a ${locale} hint, except where the code has none`, () => {
      const missing = wordings
        .filter((key) => !HAS_NO_HINT.some((code) => key === `problem_${code}`))
        .filter((key) => !exists(locale, `${key}_hint`));
      expect(missing).toEqual([]);
    });

    it(`every kind of dangling reference has a ${locale} noun`, () => {
      const missing = DANGLING_KINDS.keys.filter((k) => !exists(locale, `problem_what_${k}`));
      expect(missing).toEqual([]);
    });
  }

  it('the German text is German: no entry equals its English text except shared technical ones', () => {
    const same = wordings.filter(
      (k) => messages('de')(k as MessageKey, {}) === messages('en')(k as MessageKey, {}),
    );
    expect(same).toEqual([]);
  });
});

const dangling: Problem = {
  path: 'types.baum.properties.art.to',
  code: 'dangling_reference',
  message: "'gibt_es_nicht' is not a known feature type",
  hint: 'use one of: baumart, flaeche',
  params: { value: 'gibt_es_nicht', what: 'feature_type', existing: 'baumart, flaeche' },
};

describe('problemText', () => {
  it('words a dangling reference in German with the values filled in', () => {
    const t = problemText(dangling, 'de');
    expect(t.message).toBe('Objektart „gibt_es_nicht“ gibt es nicht.');
    expect(t.hint).toBe('Verwenden Sie einen der vorhandenen Einträge: baumart, flaeche.');
  });

  it('words it in English from the same params', () => {
    const t = problemText(dangling, 'en');
    expect(t.message).toBe('"gibt_es_nicht" is not a known feature type.');
    expect(t.hint).toBe('Use one of: baumart, flaeche.');
  });

  it('uses the noun of the kind, with its parameters', () => {
    const p: Problem = {
      ...dangling,
      params: { value: 'x', what: 'property_of', of: 'baum', existing: 'a, b' },
    };
    expect(problemText(p, 'de').message).toBe('Eigenschaft von baum „x“ gibt es nicht.');
  });

  it('words task_field_not_writable in German', () => {
    const p: Problem = {
      path: 'tasks.kontrolle.form.hoehe',
      code: 'task_field_not_writable',
      message: 'x',
      hint: 'y',
      params: { task: 'kontrolle', roles: 'kontrolle, admin', field: 'hoehe', types: 'baum' },
    };
    const t = problemText(p, 'de');
    expect(t.message).toBe(
      'Keine Rolle, die die Aufgabe „kontrolle“ ausführen darf (kontrolle, admin), darf „hoehe“ von baum schreiben; der Durchlauf wird abgelehnt.',
    );
    expect(t.hint).toContain('permissions.write');
  });

  it('words a merge issue, picking the variant', () => {
    const template = openProject(musterstadt.templateSrc, musterstadt.overlaySrc).effective();
    const overlay = {
      schema: 'ueberblick/1',
      extends: 'baumkataster@1',
      override: { 'types.nix.label': 'x' },
      hide: ['types.nix'],
    };
    const issues = merge(template, overlay).issues;
    const [override, hide] = problemsFromMergeIssues(issues);
    expect(problemText(override as Problem, 'de').message).toBe(
      'Die Vorlage hat kein types.nix.label, das sich überschreiben ließe.',
    );
    expect(problemText(hide as Problem, 'de').message).toBe(
      'Die Vorlage hat kein types.nix, das sich ausblenden ließe.',
    );
    expect(problemText(hide as Problem, 'en').message).toBe('The template has no types.nix to hide.');
  });

  it('words a schema problem from its detail, with no hint', () => {
    const p: Problem = { path: '', code: 'schema_invalid', message: 'types: Required' };
    expect(problemText(p, 'de')).toEqual({ message: 'Die Datei passt nicht zum Schema: types: Required' });
  });

  it('a problem that carries no params (not made by compile) keeps its English text', () => {
    const p: Problem = { path: 'x', code: 'dangling_reference', message: 'abc', hint: 'def' };
    expect(problemText(p, 'de')).toEqual({ message: 'abc', hint: 'def' });
  });

  it('refuses a variant the catalogue lacks instead of falling back', () => {
    const params: ProblemParams = { variant: 'nope' };
    expect(() => problemText({ ...dangling, params }, 'de')).toThrow(/missing/);
  });
});

describe('problem items in the German locale', () => {
  it('the panel list is German with the values filled in', () => {
    const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc).apply({
      kind: 'set',
      path: 'types.baum.properties.art.to',
      value: 'gibt_es_nicht',
    }).doc;
    const [first] = problemItems(doc, 'de');
    expect(first?.message).toBe('Objektart „gibt_es_nicht“ gibt es nicht.');
    expect(first?.hint).toContain('baumart');
  });
});
