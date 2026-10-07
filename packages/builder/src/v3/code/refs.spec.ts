import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { open } from '../../doc/fixtures';
import { completeRefs, refSources, type RefSources } from './refs';

const sources: RefSources = {
  property: [
    { key: 'befund', label: 'Befund' },
    { key: 'hoehe_m', label: 'Höhe (m)' },
  ],
  stage: [{ key: 'erfasst', label: 'Erfasst' }],
  role: [
    { key: 'kontrolle', label: 'Baumkontrolle' },
    { key: 'bauhof', label: 'Bauhof' },
  ],
  task: [{ key: 'kontrolle', label: 'Kontrolle durchführen' }],
  type: [{ key: 'baum', label: 'Baum' }],
};

/** Completes at the `|` in `marked`. */
const at = (marked: string, s: RefSources = sources) => {
  const pos = marked.indexOf('|');
  return completeRefs(marked.replace('|', ''), pos, s);
};

describe('refSources: the project keys', () => {
  it('offers the properties and stages of the Objektart, the roles, tasks and Objektarten', () => {
    const s = refSources(open(), 'baum', 'de');
    expect(s.property?.map((i) => i.key)).toContain('befund');
    expect(s.property?.find((i) => i.key === 'vitalitaet')?.label).toBe('Vitalität (Roloff)');
    expect(s.stage?.map((i) => i.key)).toEqual(['erfasst', 'kontrolliert', 'massnahme', 'erledigt']);
    expect(s.role?.map((i) => i.key)).toEqual(expect.arrayContaining(['kontrolle', 'bauhof', 'verwaltung']));
    expect(s.task?.map((i) => i.key)).toContain('kontrolle');
    expect(s.type?.map((i) => i.key)).toContain('baum');
  });
});

describe('completeRefs', () => {
  it('shows the name and inserts the key', () => {
    const r = at('process:\n  property: |');
    expect(r?.options.map((o) => [o.label, o.apply])).toEqual([
      ['Befund', 'befund'],
      ['Höhe (m)', 'hoehe_m'],
    ]);
    expect(r?.options[0]?.detail).toBe('befund');
  });

  it('completes stages after start and end, tasks after `after`, roles after roles', () => {
    expect(at('process: { x: 1 }\nstart: |')?.options[0]?.kind).toBe('stage');
    expect(at('tasks:\n  t:\n    auto:\n      n:\n        after: |')?.options[0]?.apply).toBe('kontrolle');
    expect(at('app:\n  roles: [kontrolle, |]')?.options.map((o) => o.kind)).toEqual(['role', 'role']);
  });

  it('completes roles in a permission list, inline, in a flow list and as block items', () => {
    const inline = at('permissions:\n  create: [ba|');
    expect(inline?.options.map((o) => o.apply)).toEqual(['kontrolle', 'bauhof']);
    expect(inline?.from).toBe('permissions:\n  create: ['.length);
    expect(at('permissions:\n  write:\n    befund: [|')?.options[0]?.kind).toBe('role');
    expect(at('permissions:\n  see:\n    - |')?.options[0]?.kind).toBe('role');
  });

  it("a form key list under a view completes properties; an automatic action's `change:` does not complete types", () => {
    expect(at('views:\n  v:\n    properties:\n      - |')?.options[0]?.kind).toBe('property');
    expect(at('tasks:\n  t:\n    auto:\n      n:\n        change: |')).toBeUndefined();
    expect(at('tasks:\n  t:\n    on: |')?.options[0]?.kind).toBe('type');
  });

  it('offers nothing on a key, on a line without a key, or without sources', () => {
    expect(at('process:\n  prop|')).toBeUndefined();
    expect(at('label: |')).toBeUndefined();
    expect(at('process:\n  property: |', {})).toBeUndefined();
  });

  it('property: the replaced word always starts inside the line, at or before the cursor', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 8 }).filter((s) => !/[\n[,"']/.test(s)),
        (typed) => {
          const text = `permissions:\n  create: [${typed}`;
          const r = completeRefs(text, text.length, sources);
          if (r !== undefined) {
            expect(r.from).toBeLessThanOrEqual(text.length);
            expect(r.from).toBeGreaterThanOrEqual(text.lastIndexOf('[') + 1);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
