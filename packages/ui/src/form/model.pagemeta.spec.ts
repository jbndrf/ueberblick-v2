// WP-672: the model carries page titles and descriptions and the placeholder.
import { describe, expect, it } from 'vitest';
import type { Property } from '@ueberblick/core/model';
import { buildFormModel } from './model';

const P = (type: string) => ({ type }) as unknown as Property;
const properties = { a: P('text'), b: P('text'), c: P('text') };

describe('page metadata and placeholder', () => {
  it('pageInfo has one entry per page: the title and description of the field that starts it', () => {
    const m = buildFormModel({
      form: { a: { placeholder: 'x' }, b: { page: { label: 'Zwei', hint: 'Text' } }, c: { page: {} } },
      properties,
    });
    expect(m.pageInfo).toEqual([{}, { title: 'Zwei', description: 'Text' }, {}]);
    expect(m.fields[0]).toMatchObject({ placeholder: 'x' });
  });
  it('the first field may carry the title of page one', () => {
    const m = buildFormModel({ form: { a: { page: { label: 'Eins' } }, b: {} }, properties });
    expect(m.pages).toHaveLength(1);
    expect(m.pageInfo).toEqual([{ title: 'Eins' }]);
  });
  it('an empty form has one empty page info', () => {
    expect(buildFormModel({ form: {}, properties }).pageInfo).toEqual([{}]);
  });
});
