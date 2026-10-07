import { describe, expect, it } from 'vitest';
import { buildFeatureSheetModel } from './model';
import { input } from './fixtures';

describe('header (WP-623)', () => {
  it('the heading is the feature type label in the locale, the title stays the display name', () => {
    expect(buildFeatureSheetModel(input({ locale: 'de' })).typeLabel).toBe('Baum');
    expect(buildFeatureSheetModel(input({ locale: 'en' })).typeLabel).toBe('Tree');
    expect(buildFeatureSheetModel(input()).title).toBe('Oak');
  });

  it('the last-changed time is passed on only when the device has it', () => {
    expect(buildFeatureSheetModel(input()).updatedAt).toBeUndefined();
    const at = '2026-03-10T10:00:00Z';
    expect(buildFeatureSheetModel(input({ updatedAt: at })).updatedAt).toBe(at);
  });
});
