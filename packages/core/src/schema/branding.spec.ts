import { describe, expect, it } from 'vitest';
import { BRANDING_ICON_MAX_BYTES, BRANDING_ICON_TYPES } from '../registry';
import { BrandingSchema } from './branding';
import { TemplateFileSchema } from './file';

const SHA = 'a'.repeat(64);
const file = (extra: Record<string, unknown>) => ({
  schema: 'ueberblick/1',
  template: { key: 't', version: '1.0.0' },
  ...extra,
});

describe('branding (A-036)', () => {
  it('accepts a name (plain or localized) and an icon sha', () => {
    expect(BrandingSchema.safeParse({ name: 'Stadt', icon: SHA }).success).toBe(true);
    expect(BrandingSchema.safeParse({ name: { de: 'Stadt', en: 'City' } }).success).toBe(true);
    expect(BrandingSchema.safeParse({}).success).toBe(true);
  });
  it('refuses an icon that is no sha, an empty name and unknown keys', () => {
    expect(BrandingSchema.safeParse({ icon: 'logo.png' }).success).toBe(false);
    expect(BrandingSchema.safeParse({ icon: 'A'.repeat(64) }).success).toBe(false);
    expect(BrandingSchema.safeParse({ name: '' }).success).toBe(false);
    expect(BrandingSchema.safeParse({ colour: 'red' }).success).toBe(false);
  });
  it('is an optional section of the project file', () => {
    expect(TemplateFileSchema.safeParse(file({ branding: { name: 'X', icon: SHA } })).success).toBe(true);
    expect(TemplateFileSchema.safeParse(file({})).success).toBe(true);
    expect(TemplateFileSchema.safeParse(file({ branding: { icon: 'x' } })).success).toBe(false);
  });
  it('the icon types and cap are registry values', () => {
    expect([...BRANDING_ICON_TYPES.keys].sort()).toEqual(
      ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'].sort(),
    );
    expect(BRANDING_ICON_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});
