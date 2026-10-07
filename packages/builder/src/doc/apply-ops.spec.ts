import { describe, expect, it } from 'vitest';
import { applyOps, openProject, type Doc } from './index';
import { freshProblems, musterstadt, set } from './fixtures';

const plain = (): Doc =>
  openProject(musterstadt.templateSrc, 'schema: ueberblick/1\nextends: baumkataster@1\n');

describe('applyOps: the all-or-none fold (WP-332)', () => {
  it('no ops: the same Doc and its problems', () => {
    const doc = plain();
    expect(applyOps(doc, [])).toEqual({ doc, problems: doc.problems() });
  });

  it('every op applies: the last Doc, with the problems of its effective file', () => {
    const doc = plain();
    const r = applyOps(doc, [
      set('types.baum.label', 'Gehölz'),
      { kind: 'add', path: 'types.baum.properties.notiz', value: { type: 'text', label: 'N' } },
    ]);
    expect('refused' in r).toBe(false);
    if ('refused' in r) return;
    expect(r.doc).not.toBe(doc);
    expect(r.doc.overlay().override?.['types.baum.label']).toBe('Gehölz');
    expect(r.doc.effective().types?.['baum']).toMatchObject({ label: 'Gehölz' });
    expect(r.doc.entityYaml('types.baum').text).toContain('notiz');
    expect(r.problems).toEqual(freshProblems(musterstadt.templateSrc, r.doc.save().overlaySrc));
  });

  it('a refused op drops the whole fold: the original Doc is untouched', () => {
    const doc = plain();
    const before = {
      src: doc.save().overlaySrc,
      revision: doc.save().revision,
      effective: doc.effective(),
      overlay: doc.overlay(),
    };
    // The first op makes types.baum.label a scalar; the second would set below that scalar.
    const r = applyOps(doc, [set('types.baum.label', 'X'), set('types.baum.label.de', 'Y')]);
    expect('refused' in r).toBe(true);
    if (!('refused' in r)) return;
    expect(r.refused.path).toBe('types.baum.label.de');
    expect(r.refused.message).toContain('Reset types.baum.label first');
    expect(doc.save().overlaySrc).toBe(before.src);
    expect(doc.save().revision).toBe(before.revision);
    expect(doc.effective()).toEqual(before.effective);
    expect(doc.overlay()).toEqual(before.overlay);
    expect(doc.overlay().override?.['types.baum.label']).toBeUndefined();
  });

  it('the first refusal wins: ops after it are not applied', () => {
    const doc = plain();
    const r = applyOps(doc, [
      set('types.baum.label', 'X'),
      set('types.baum.label.de', 'Y'), // refused
      set('tasks.kontrolle.label', 'K'), // would apply, but is not tried
    ]);
    expect('refused' in r).toBe(true);
    if (!('refused' in r)) return;
    expect(r.refused.path).toBe('types.baum.label.de');
    expect('doc' in r).toBe(false);
    expect(doc.overlay().override?.['tasks.kontrolle.label']).toBeUndefined();
  });
});

describe('Doc.applyBatch: the schema is checked on the end state (WP-446)', () => {
  const S = 'tasks.baum_bearbeiten';
  const steps = [{ kind: 'form' }, { kind: 'quick_edit', properties: ['hoehe_m'] }];

  it('ops that are invalid one by one apply together; the Doc stays immutable', () => {
    const doc = plain();
    expect(doc.apply(set(`${S}.form`, {})).refused).toBeDefined();
    expect(doc.apply(set(`${S}.steps`, steps)).refused).toBeDefined();
    const both = doc.applyBatch([set(`${S}.form`, {}), set(`${S}.steps`, steps)]);
    expect('doc' in both).toBe(true);
    if (!('doc' in both)) return;
    expect(both.doc.effective().tasks?.['baum_bearbeiten']?.steps).toEqual(steps);
    expect(doc.effective().tasks?.['baum_bearbeiten']?.steps).not.toEqual(steps);
  });

  it('an end state that breaks the schema is refused whole; so is an op-level refusal', () => {
    const doc = plain();
    const bad = doc.applyBatch([set('types.baum.label', 'X'), set(`${S}.form`, {})]);
    expect('refused' in bad).toBe(true);
    const unknown = doc.applyBatch([set('types.baum.label', 'X'), set('types.baum.label.de', 'Y')]);
    expect('refused' in unknown).toBe(true);
    expect(doc.overlay().override?.['types.baum.label']).toBeUndefined();
  });
});
