import { describe, expect, it } from 'vitest';
import { InfoPagesSchema } from './info-pages';
import { parseProjectFile } from './file';

describe('info pages', () => {
  it('accepts title, content and sort_order, plain or localized', () => {
    const ok = InfoPagesSchema.safeParse({
      hilfe: { title: 'Hilfe', content: '<p>Text</p>', sort_order: 2 },
      start: { title: { de: 'Start', en: 'Start' }, content: { de: '<p>x</p>' } },
    });
    expect(ok.success).toBe(true);
  });
  it('refuses unknown keys and missing content', () => {
    expect(InfoPagesSchema.safeParse({ a: { title: 'a', content: 'b', roles: ['x'] } }).success).toBe(false);
    expect(InfoPagesSchema.safeParse({ a: { title: 'a' } }).success).toBe(false);
  });
  it('is a section of the project file', () => {
    const file = {
      schema: 'ueberblick/1',
      template: { key: 't', version: '1.0.0' },
      info_pages: { hilfe: { title: 'Hilfe', content: '<p>x</p>' } },
    };
    expect(parseProjectFile(file).success).toBe(true);
    const bad = { ...file, info_pages: { hilfe: { title: 'x', content: 'y', z: 1 } } };
    expect(parseProjectFile(bad).success).toBe(false);
  });
});
