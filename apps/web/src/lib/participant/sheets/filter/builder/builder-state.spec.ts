import { describe, expect, it } from 'vitest';
import type { BuilderContext, Clause } from '@ueberblick/core/filters';
import { defaultClause, fieldId, otherClause, otherKinds, pickedIds, pickFields } from './builder-state';

const field = (
  key: string,
  propType: 'text' | 'number' | 'date' | 'select',
  editor: 'text' | 'number' | 'date' | 'choice',
) => ({
  type: 'baum',
  typeLabel: 'Baum',
  key,
  label: key,
  propType,
  editor,
  options: editor === 'choice' ? [{ value: 'a', label: 'A' }] : [],
});

const ctx: BuilderContext = {
  types: ['baum'],
  fields: [
    field('name', 'text', 'text'),
    field('hoehe', 'number', 'number'),
    field('tag', 'date', 'date'),
    field('art', 'select', 'choice'),
  ],
  stages: [{ type: 'baum', typeLabel: 'Baum', property: 'stufe', stages: [{ value: 'neu', label: 'Neu' }] }],
};

describe('the builder rows (v3 FilterBuilder:49-160)', () => {
  it('a picked field gets the editor of its type, empty', () => {
    expect(ctx.fields.map((f) => defaultClause(f))).toMatchObject([
      { editor: 'text', text: '' },
      { editor: 'number', min: null, max: null },
      { editor: 'date', from: null, to: null },
      { editor: 'choice', values: [] },
    ]);
  });
  it('the new types get their editors, open (WP-809)', () => {
    const f = (
      propType: 'boolean' | 'time' | 'participant' | 'reference' | 'localized_text',
      editor: never,
    ) => ({ ...field('x', 'text', 'text'), propType, editor }) as never;
    expect([
      defaultClause(f('boolean', 'boolean' as never)),
      defaultClause(f('time', 'time' as never)),
      defaultClause(f('participant', 'participant' as never)),
      defaultClause(f('reference', 'presence' as never)),
      defaultClause(f('localized_text', 'presence' as never)),
    ]).toMatchObject([
      { editor: 'boolean', value: null },
      { editor: 'time', from: null, to: null },
      { editor: 'participant', me: false },
      { editor: 'presence', state: null },
      { editor: 'presence', state: null },
    ]);
  });
  it('the picker adds rows at the end and removes only the unpicked field rows; other rows stay', () => {
    const when: Clause = { kind: 'when', field: 'created', mode: 'older', days: 7, from: null, to: null };
    const one = pickFields([when], ctx, ['baum|name']);
    expect(one.map((c) => c.kind)).toEqual(['when', 'field']);
    const two = pickFields(one, ctx, ['baum|name', 'baum|hoehe']);
    expect(pickedIds(two)).toEqual(['baum|name', 'baum|hoehe']);
    const back = pickFields(two, ctx, ['baum|hoehe']);
    expect(back.map((c) => c.kind)).toEqual(['when', 'field']);
    expect(pickedIds(back)).toEqual(['baum|hoehe']);
  });
  it('is idempotent: the same picks give the same list (v3 guard against the picker bouncing)', () => {
    const rows = pickFields([], ctx, ['baum|name']);
    expect(pickFields(rows, ctx, ['baum|name'])).toBe(rows);
  });
  it('ignores an id that is not offered', () => {
    expect(pickFields([], ctx, ['baum|weg'])).toEqual([]);
  });
  it('fresh other rows: Stufe on the first Objektart with stages, "older than 7 days", no creators', () => {
    expect(otherClause('stage', ctx)).toEqual({ kind: 'stage', type: 'baum', values: [] });
    expect(otherClause('created', ctx)).toMatchObject({
      kind: 'when',
      field: 'created',
      mode: 'older',
      days: 7,
    });
    expect(otherClause('changed', ctx)).toMatchObject({ field: 'changed' });
    expect(otherClause('created_by', ctx)).toEqual({ kind: 'created_by', values: [] });
  });
  it('offers no Stufe when no Objektart has a process', () => {
    expect(otherKinds({ ...ctx, stages: [] })).toEqual(['created', 'changed', 'created_by']);
    expect(otherClause('stage', { ...ctx, stages: [] })).toBeUndefined();
    expect(otherKinds(ctx)).toHaveLength(4);
  });
  it('field ids are type and key', () => {
    expect(fieldId({ type: 'baum', key: 'name' })).toBe('baum|name');
  });
});
