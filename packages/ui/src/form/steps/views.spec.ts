// WP-636: the views of a multi-step task. The form step shows only the form's fields, the quick-edit step only the
// picked properties on their current values, the location step names its geometry property.
import { describe, expect, it } from 'vitest';
import { mergeStepValues } from './merge';
import { point, properties, viewsOf } from './steps.testing';

const form = { befund: { required: true } };

describe('buildStepViews', () => {
  it('keeps the order of the steps', () => {
    const views = viewsOf({
      form,
      steps: [
        { kind: 'quick_edit', properties: ['art'] },
        { kind: 'form' },
        { kind: 'location', property: 'lage' },
      ],
    });
    expect(views.map((v) => v.kind)).toEqual(['quick_edit', 'form', 'location']);
  });

  it('the form step shows only the fields of the form, not the quick-edit ones', () => {
    const [first] = viewsOf({
      form,
      steps: [{ kind: 'form' }, { kind: 'quick_edit', properties: ['art', 'hoehe'] }],
    });
    expect(first?.kind === 'form' && first.session.model.fields.map((f) => f.key)).toEqual(['befund']);
  });

  it('the quick-edit step shows only the picked properties, opened on their current values', () => {
    const [view] = viewsOf(
      { steps: [{ kind: 'quick_edit', properties: ['art', 'hoehe'] }] },
      { art: 'Linde', hoehe: 12, befund: 'gesund' },
    );
    if (view?.kind !== 'quick_edit') throw new Error('expected a quick-edit step');
    expect(view.session.model.fields.map((f) => f.key)).toEqual(['art', 'hoehe']);
    expect(view.session.get('art')).toBe('Linde');
    expect(view.session.get('hoehe')).toBe(12);
  });

  it('emptying a quick-edit value warns and submits an explicit null', () => {
    const [view] = viewsOf({ steps: [{ kind: 'quick_edit', properties: ['art'] }] }, { art: 'Linde' });
    if (view?.kind !== 'quick_edit') throw new Error('expected a quick-edit step');
    view.session.set('art', '');
    expect(view.session.clearing().map((c) => c.key)).toEqual(['art']);
    expect(view.session.submitValuesCleared()).toEqual({ art: null });
  });

  it('a location step carries the property label and where the shape is now', () => {
    const [view] = viewsOf({ steps: [{ kind: 'location', property: 'lage' }] }, { lage: point(1) });
    expect(view).toEqual({ kind: 'location', property: 'lage', label: 'Lage', current: point(1) });
  });

  it('a task with only a form is one form step', () => {
    expect(viewsOf({ form }).map((v) => v.kind)).toEqual(['form']);
  });
});

describe('mergeStepValues', () => {
  it('joins the values of every step into one input', () => {
    expect(mergeStepValues([{ befund: 'ok' }, undefined, { lage: point(2) }])).toEqual({
      befund: 'ok',
      lage: point(2),
    });
  });

  it('a multi-step task with a bind field builds its views from `bound` (A-047)', () => {
    const bound = { ref: { label: 'Prüfer', properties: { name: properties['art'] as never } } };
    const views = viewsOf(
      {
        form: { befund: {}, 'ref.name': {} },
        steps: [{ kind: 'form' }, { kind: 'quick_edit', properties: ['art'] }],
      },
      {},
      bound,
    );
    const f = views[0];
    expect(f?.kind === 'form' && f.session.model.fields.map((x) => x.key)).toEqual(['befund', 'ref.name']);
  });
});
