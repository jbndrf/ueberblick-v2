// WP-414: an order line names its owner (the Objektart, task, property ...), table-driven over `ORDERED_MAPS`.
import { describe, expect, it } from 'vitest';
import type { PlannedChange } from '@ueberblick/server';
import type { TemplateFile } from '@ueberblick/core';
import { ORDERED_MAPS } from '@ueberblick/core/registry/compile';
import { lineText } from './entry-text';
import { groupsOf, type PlanInput } from './plan-view';

/** A concrete path of a pattern: every `*` becomes `k`. */
const concrete = (pattern: string): string[] => pattern.split('.').map((s) => (s === '*' ? 'k' : s));
/** The element that owns the map: two segments, or the property for the options of a property. */
const ownerOf = (pattern: string): string[] =>
  concrete(pattern).slice(0, pattern.endsWith('.options') ? 4 : 2);

function fileWith(owner: string[]): TemplateFile {
  const root: Record<string, unknown> = { schema: 'ueberblick/1', template: { key: 'k', version: '1' } };
  let cur = root;
  for (const s of owner) {
    const next: Record<string, unknown> = {};
    cur[s] = next;
    cur = next;
  }
  cur.label = { de: 'Eigner', en: 'Owner' };
  return root as unknown as TemplateFile;
}

const input = (pattern: string, locale: string): PlanInput => {
  const path = concrete(pattern).join('.');
  const after = fileWith(pattern.includes('*') ? ownerOf(pattern) : []);
  const diff = [{ path, change: 'order_changed', breaking: false }] as PlannedChange[];
  return { before: after, after, diff, versions: [], affected: [], locale };
};

const linesOf = (pattern: string, locale: 'de' | 'en'): string[] =>
  groupsOf(input(pattern, locale)).flatMap((g) => g.entries.map((e) => lineText(locale, e)));

describe.each(ORDERED_MAPS.keys.map((k) => [k]))('the order line of %s', (pattern) => {
  const last = concrete(pattern).at(-1) as string;
  for (const locale of ['de', 'en'] as const) {
    it(`reads as one line in ${locale} and never names the map key`, () => {
      const lines = linesOf(pattern, locale);
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain(`„${last}“`);
      expect(lines[0]).not.toContain(`“${last}”`);
      expect(lines[0]).toMatch(locale === 'de' ? /Reihenfolge/ : /order/i);
    });
    if (pattern.includes('*')) {
      it(`names its owner in ${locale}`, () => {
        expect(linesOf(pattern, locale)[0]).toContain(locale === 'de' ? '„Eigner“' : '“Owner”');
      });
    }
  }
});

describe('order lines in words', () => {
  it('names the Objektart for its properties', () => {
    expect(linesOf('types.*.properties', 'de')[0]).toBe(
      'Objektart „Eigner“: Reihenfolge der Eigenschaften geändert',
    );
    expect(linesOf('types.*.properties', 'en')[0]).toBe('Objektart “Owner”: order of properties changed');
  });
  it('names the task for its form fields and the property for its options', () => {
    expect(linesOf('tasks.*.form', 'de')[0]).toBe(
      'Aufgabe „Eigner“: Reihenfolge der Formularfelder geändert',
    );
    expect(linesOf('types.*.properties.*.options', 'de')[0]).toBe(
      'Eigenschaft „Eigner“: Reihenfolge der Optionen geändert',
    );
  });
  it('a top-level map has no owner', () => {
    expect(linesOf('types', 'de')[0]).toBe('Reihenfolge der Objektarten geändert');
  });
});
