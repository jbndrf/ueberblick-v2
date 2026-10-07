import { describe, expect, it } from 'vitest';
import { THUMB_SIZES } from '.';

describe('thumbnail size registry', () => {
  it('carries the v3 sizes: an 80x80 cropped square and 800 pixels wide', () => {
    expect(THUMB_SIZES.keys).toEqual(['list', 'preview']);
    expect(THUMB_SIZES.get('list')).toMatchObject({ width: 80, height: 80, crop: true });
    const preview = THUMB_SIZES.get('preview');
    expect(preview.width).toBe(800);
    expect('height' in preview).toBe(false);
    expect('crop' in preview).toBe(false);
  });

  it('names only the registry keys', () => {
    for (const value of ['list', 'preview', '80', '800', '160', ''])
      expect(THUMB_SIZES.has(value)).toBe(value === 'list' || value === 'preview');
  });
});
