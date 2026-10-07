import { describe, expect, it } from 'vitest';
import { lockOf, openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { hasTemplate, hideOps, provenanceOf, resetOps } from './provenance';

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const PROP = 'types.baum.properties.befund';

function applyAll(doc: Doc, ops: ReturnType<typeof resetOps>): Doc {
  return ops.reduce((d, op) => {
    const r = d.apply(op);
    expect(r.refused).toBeUndefined();
    return r.doc;
  }, doc);
}

describe('provenance of an element', () => {
  it('is template, changed or added, the strongest of its paths', () => {
    let doc = clean();
    expect(provenanceOf(doc, [PROP])?.kind).toBe('template');
    doc = doc.apply({ kind: 'set', path: `${PROP}.label`, value: { de: 'Zustand' } }).doc;
    expect(provenanceOf(doc, [PROP])?.kind).toBe('changed');
    expect(provenanceOf(doc, ['types.baum.properties.patenschaft'])?.kind).toBe('added');
    expect(provenanceOf(doc, [PROP, 'types.baum.properties.patenschaft'])?.kind).toBe('added');
  });

  it('shows no mark for a project without a template', () => {
    const blank = openProject(
      'schema: ueberblick/1\ntemplate: { key: leer, version: 1.0.0 }\n',
      'schema: ueberblick/1\nextends: leer@1\n',
    );
    expect(hasTemplate(blank)).toBe(false);
    expect(provenanceOf(blank, [PROP])).toBeUndefined();
    expect(provenanceOf(clean(), [PROP])).toBeDefined();
  });

  it('names the template lock that covers the element', () => {
    const doc = clean();
    expect(lockOf(doc, 'types.baum.properties.stage')).toBe('types.baum.properties.stage.options');
    expect(lockOf(doc, PROP)).toBeUndefined();
    expect(provenanceOf(doc, ['types.baum.properties.stage'])?.lock).toBe(
      'types.baum.properties.stage.options',
    );
  });
});

describe('reset and hide', () => {
  it('a reset puts a changed element back to the template, below the path too', () => {
    let doc = clean();
    doc = doc.apply({ kind: 'set', path: `${PROP}.label`, value: { de: 'Zustand' } }).doc;
    doc = doc.apply({ kind: 'set', path: `${PROP}.display`, value: { column: 'left' } }).doc;
    const before = clean().effective().types?.['baum']?.properties['befund'];
    const back = applyAll(doc, resetOps(doc, [PROP]));
    expect(back.provenance(PROP)).toBe('template');
    expect(back.effective().types?.['baum']?.properties['befund']).toEqual(before);
  });

  it('a reset of a task with a changed label keeps the rest of the overlay', () => {
    const doc = clean();
    expect(doc.provenance('tasks.kontrolle')).toBe('changed');
    const back = applyAll(doc, resetOps(doc, ['tasks.kontrolle']));
    expect(back.provenance('tasks.kontrolle')).toBe('template');
    expect(back.provenance('types.baum.properties.vitalitaet')).toBe('changed');
  });

  it('nothing to reset gives no ops', () => {
    expect(resetOps(clean(), [PROP])).toEqual([]);
  });

  it('hide hides a template element and drops an added one', () => {
    const doc = clean();
    expect(hideOps(doc, PROP)).toEqual([{ kind: 'hide', path: PROP }]);
    expect(hideOps(doc, 'types.baum.properties.patenschaft')).toEqual([
      { kind: 'reset', path: 'types.baum.properties.patenschaft' },
    ]);
  });
});
