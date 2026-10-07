import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from 'yaml';
import { openProject, type Op } from './index';
import { freshProblems, musterstadt, open, project, projects, set } from './fixtures';

describe('round trip', () => {
  it.each(projects)('open -> save without edits is byte-identical: $name', ({ overlaySrc, templateSrc }) => {
    const doc = openProject(templateSrc, overlaySrc);
    expect(doc.save().overlaySrc).toBe(overlaySrc);
    expect(doc.dirty).toBe(false);
  });

  it('keeps comments and key order after an edit elsewhere', () => {
    const r = open().apply(set('tasks.kontrolle.label', { de: 'Neu' }));
    const out = r.doc.save().overlaySrc;
    expect(out).toContain('# conflicts with 2.0.0');
    expect(out).toContain('# kept override on upgrade');
    expect(out.indexOf('inputs:')).toBeLessThan(out.indexOf('override:'));
    expect(out.indexOf('override:')).toBeLessThan(out.indexOf('add:'));
    expect(out.indexOf('add:')).toBeLessThan(out.indexOf('hide:'));
  });

  it('refuses sources that do not parse or fit together', () => {
    expect(() => openProject(musterstadt.templateSrc, 'schema: nope')).toThrow();
    expect(() => openProject('a: [', musterstadt.overlaySrc)).toThrow();
    expect(() =>
      openProject(
        musterstadt.templateSrc,
        musterstadt.overlaySrc.replace('baumkataster@1', 'veranstaltung@1'),
      ),
    ).toThrow();
  });

  it('opens an overlay that extends the exact template version (what an import pins), and edits it', () => {
    const version = (parse(musterstadt.templateSrc) as { template: { version: string } }).template.version;
    const src = musterstadt.overlaySrc.replace('baumkataster@1', `baumkataster@${version}`);
    const doc = openProject(musterstadt.templateSrc, src);
    expect(doc.save().overlaySrc).toBe(src);
    expect(doc.replaceOverlay(`${src}# x\n`).refused).toBeUndefined();
    expect(() => openProject(musterstadt.templateSrc, src.replace(`@${version}`, '@9.9.9'))).toThrow();
  });
});

describe('ops', () => {
  it('set on a template value writes an override entry and changes the effective file', () => {
    const r = open().apply(set('types.baum.label', 'Straßenbaum'));
    expect(r.doc.overlay().override?.['types.baum.label']).toBe('Straßenbaum');
    expect(r.doc.effective().types?.['baum']?.label).toBe('Straßenbaum');
    expect(r.doc.template.types?.['baum']?.label).not.toBe('Straßenbaum');
    expect(r.doc.provenance('types.baum.label')).toBe('changed');
  });

  it('set on a fresh path creates the override section; on inputs writes inputs', () => {
    const plain = openProject(
      project('musterstadt-plain.yaml').templateSrc,
      'schema: ueberblick/1\nextends: baumkataster@1\n',
    );
    const a = plain.apply(set('tasks.kontrolle.label', 'K')).doc;
    expect(a.overlay().override).toEqual({ 'tasks.kontrolle.label': 'K' });
    const b = a.apply(set('inputs.kontrollintervall_monate', 7)).doc;
    expect(b.overlay().inputs).toEqual({ kontrollintervall_monate: 7 });
    expect(b.effective().inputs?.['kontrollintervall_monate']?.default).toBe(7);
  });

  it('add writes an add entry; set inside an added entity edits that entry in place', () => {
    const d1 = open().apply({ kind: 'add', path: 'views.neu', value: { source: { type: 'baum' } } }).doc;
    expect(d1.provenance('views.neu')).toBe('added');
    const d2 = d1.apply(set('views.neu.label', 'Neu')).doc;
    expect(d2.overlay().add?.['views.neu']).toEqual({ source: { type: 'baum' }, label: 'Neu' });
    expect(d2.overlay().override?.['views.neu.label']).toBeUndefined();
    expect(d2.provenance('views.neu.label')).toBe('added');
    expect(d2.provenance('views.paten.label')).toBe('added');
  });

  it('adding an existing template path is refused (merge would report path_exists)', () => {
    const r = open().apply({ kind: 'add', path: 'tasks.kontrolle', value: { on: 'baum', form: {} } });
    expect(r.refused?.message).toContain('tasks.kontrolle');
    expect(r.problems.some((p) => p.code === 'path_exists')).toBe(false);
  });

  it('hide and unhide toggle a hide entry and are idempotent', () => {
    const d1 = open().apply({ kind: 'hide', path: 'views.karte' }).doc;
    expect(d1.overlay().hide).toEqual(['tasks.erfassung_import', 'views.karte']);
    expect(d1.apply({ kind: 'hide', path: 'views.karte' }).doc).toBe(d1);
    const d2 = d1.apply({ kind: 'unhide', path: 'views.karte' }).doc;
    expect(d2.overlay().hide).toEqual(['tasks.erfassung_import']);
    const d3 = d2.apply({ kind: 'unhide', path: 'tasks.erfassung_import' }).doc;
    expect(d3.overlay().hide).toBeUndefined();
    expect(d3.save().overlaySrc).not.toContain('hide');
  });

  it('a set on an ancestor removes overridden descendants; a set on a descendant of an override edits it', () => {
    const d1 = open().apply(set('types.baum.properties.vitalitaet.label', { de: 'A' })).doc;
    const d2 = d1.apply(set('types.baum.properties.vitalitaet', { type: 'text', label: 'B' })).doc;
    expect(Object.keys(d2.overlay().override ?? {})).not.toContain('types.baum.properties.vitalitaet.label');
    const d3 = d2.apply(set('types.baum.properties.vitalitaet.label', 'C')).doc;
    expect(d3.overlay().override?.['types.baum.properties.vitalitaet']).toEqual({ type: 'text', label: 'C' });
  });

  it('an invalid key path is refused with a problem and changes nothing', () => {
    const doc = open();
    const r = doc.apply(set('Types..bad', 1));
    expect(r.doc).toBe(doc);
    expect(r.refused?.path).toBe('Types..bad');
    expect(r.problems).toEqual(doc.problems());
  });

  it('an op that would break the file schema is refused and changes nothing', () => {
    const doc = open();
    const r = doc.apply(set('types.baum.label', 5));
    expect(r.doc).toBe(doc);
    expect(r.refused?.message).toContain('file schema');
  });

  it('the locked-violation fixture violates only the lock: merge problems, no schema_invalid', () => {
    const doc = open(project('musterstadt-locked-violation.yaml'));
    const codes = doc.problems().map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['lock_violation', 'hidden_referenced']));
    expect(codes).not.toContain('schema_invalid');
  });

  it('an overlay that already breaks the schema opens with schema_invalid problems and skips compile', () => {
    const src = musterstadt.overlaySrc.replace('override:', 'override:\n  types.baum.label: 5');
    const doc = openProject(musterstadt.templateSrc, src);
    const bad = doc.problems().filter((p) => p.code === 'schema_invalid');
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]?.path).toContain('types.baum.label');
    expect(bad[0]?.hint?.length).toBeGreaterThan(0);
    // Fixing one thing is allowed even though the file stays invalid.
    expect(doc.apply({ kind: 'reset', path: 'tasks.kontrolle.label' }).refused).toBeUndefined();
    // Fixing the cause makes the file valid and compiled again.
    const fixed = doc.apply({ kind: 'reset', path: 'types.baum.label' });
    expect(fixed.problems.some((p) => p.code === 'schema_invalid')).toBe(false);
  });

  it('an op on a locked path is refused with the lock, not an exception', () => {
    const doc = open();
    const r = doc.apply(set('types.baum.properties.stage.options', { x: 'X' }));
    expect(r.doc).toBe(doc);
    expect(r.refused?.message).toContain('locks');
  });
});

describe('reset and provenance', () => {
  it('reset removes exactly the overlay entry and nothing else', () => {
    const doc = open();
    const before = doc.overlay();
    const r = doc.apply({ kind: 'reset', path: 'tasks.kontrolle.label' }).doc;
    const after = r.overlay();
    expect(after.override).toEqual({
      'types.baum.properties.vitalitaet.label': before.override?.['types.baum.properties.vitalitaet.label'],
    });
    expect({ ...after, override: undefined }).toEqual({ ...before, override: undefined });
    expect(r.provenance('tasks.kontrolle.label')).toBe('template');
    expect(r.effective().tasks?.['kontrolle']?.label).toEqual(doc.template.tasks?.['kontrolle']?.label);
  });

  it('reset of an add entry, an input and the last override entry tidies the empty section', () => {
    let d = open();
    d = d.apply({ kind: 'reset', path: 'views.paten' }).doc;
    expect(d.overlay().add?.['views.paten']).toBeUndefined();
    d = d.apply({ kind: 'reset', path: 'types.baum.properties.patenschaft' }).doc;
    expect(d.overlay().add).toBeUndefined();
    d = d.apply({ kind: 'reset', path: 'inputs.kontrollintervall_monate' }).doc;
    expect(d.overlay().inputs).toBeUndefined();
    expect(d.save().overlaySrc).not.toMatch(/^add:/m);
  });

  it('reset of a path without an entry changes nothing', () => {
    const doc = open();
    expect(doc.apply({ kind: 'reset', path: 'types.baum.label' }).doc).toBe(doc);
  });

  it('provenance reports template / changed / added', () => {
    const doc = open();
    expect(doc.provenance('types.baum.label')).toBe('template');
    expect(doc.provenance('tasks.kontrolle.label')).toBe('changed');
    expect(doc.provenance('types.baum.properties.patenschaft')).toBe('added');
    expect(doc.provenance('types.baum.properties.patenschaft.label')).toBe('added');
  });
});

describe('revisions', () => {
  it('a revision follows the overlay text', () => {
    const doc = open();
    const edited = doc.apply(set('types.baum.label', 'X')).doc;
    expect(edited.save().revision).not.toBe(doc.save().revision);
    expect(open().save().revision).toBe(doc.save().revision);
  });

  it('saveIf accepts the current revision and rebases the doc', () => {
    const doc = open();
    const edited = doc.apply(set('types.baum.label', 'X')).doc;
    const r = edited.saveIf(doc.revision);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.revision).toBe(r.revision);
    expect(r.doc.dirty).toBe(false);
    expect(r.doc.saveIf(r.revision).ok).toBe(true);
  });

  it('a stale revision is refused', () => {
    const edited = open().apply(set('types.baum.label', 'X')).doc;
    const r = edited.saveIf('somebody-elses-newer-save');
    expect(r).toMatchObject({ ok: false, reason: 'stale_revision' });
  });
});

describe('properties over random op sequences', () => {
  const paths = [
    'types.baum.label',
    'types.baum.properties.vitalitaet.label',
    'types.baum.properties.befund.label',
    'types.baum.properties.patenschaft',
    'types.baum.properties.patenschaft.label',
    'types.baum.properties.stage.options',
    'tasks.kontrolle.label',
    'tasks.kontrolle',
    'tasks.melden',
    'tasks.erfassung_import',
    'views.paten',
    'views.paten.label',
    'views.neu',
    'views.karte',
    'inputs.kontrollintervall_monate',
    'nothing.here',
    'Bad..Path',
  ];
  const value = fc.oneof(
    fc.string({ maxLength: 8 }),
    fc.integer({ min: 1, max: 60 }),
    fc.constant({ de: 'X', en: 'Y' }),
  );
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('set' as const), path: fc.constantFrom(...paths), value }),
    fc.record({
      kind: fc.constant('add' as const),
      path: fc.constantFrom(...paths),
      value: fc.constant({ label: 'L', source: { type: 'baum' } }),
    }),
    fc.record({ kind: fc.constant('hide' as const), path: fc.constantFrom(...paths) }),
    fc.record({ kind: fc.constant('unhide' as const), path: fc.constantFrom(...paths) }),
    fc.record({ kind: fc.constant('reset' as const), path: fc.constantFrom(...paths) }),
  );
  const seq = fc.array(op, { maxLength: 12 });

  it('the template is never modified and only overlay sections change', () => {
    const templateJson = JSON.stringify(open().template);
    fc.assert(
      fc.property(seq, (ops) => {
        let doc = open();
        for (const o of ops) doc = doc.apply(o).doc;
        expect(doc.templateSrc).toBe(musterstadt.templateSrc);
        expect(JSON.stringify(doc.template)).toBe(templateJson);
        const saved = parse(doc.save().overlaySrc) as Record<string, unknown>;
        for (const k of Object.keys(saved))
          expect(['schema', 'extends', 'inputs', 'override', 'add', 'hide']).toContain(k);
        expect(saved['schema']).toBe('ueberblick/1');
        expect(saved['extends']).toBe('baumkataster@1');
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  it('problems after every op equal a fresh compile of the effective file', () => {
    fc.assert(
      fc.property(seq, (ops) => {
        let doc = open();
        for (const o of ops) {
          const r = doc.apply(o);
          doc = r.doc;
          const fresh = freshProblems(musterstadt.templateSrc, doc.save().overlaySrc);
          expect(r.problems).toEqual(fresh);
          expect(doc.problems()).toEqual(fresh);
          expect(openProject(musterstadt.templateSrc, doc.save().overlaySrc).effective()).toEqual(
            doc.effective(),
          );
        }
      }),
      { numRuns: 25 },
    );
  }, 60_000);
});
